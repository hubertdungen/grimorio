"""Grimório — servidor (Python stdlib).

Serve a app React compilada (web/dist), os dados gerados por build/build.sh
(já comprimidos em .gz) e guarda os decks numa SQLite fora do exFAT.
"""
import argparse, functools, hashlib, http.cookies, json, os, re, sqlite3, time, zipfile, zlib, urllib.error, urllib.parse, urllib.request, uuid
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from deck_import import UpstreamError, fetch_deck, list_profile, search_decks
import ia
import play
import playnet
import limited
import backup
import ratings
import sim
import tournament
import artfolder
import guests
import rooms
import share
import rules

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(HERE, "web", "dist")
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
         ".svg": "image/svg+xml", ".json": "application/json", ".bin": "application/octet-stream",
         ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json"}
DECK_ID = re.compile(r"^[a-z0-9-]{8,40}$")
META_PATH = re.compile(r"^/api/meta/(standard|pioneer|modern|legacy|vintage|pauper|premodern)$")
L17_PATH = re.compile(r"^/api/l17/(expansions|ratings/[A-Z0-9]{2,6})$")
EDHREC_PATH = re.compile(r"^/api/edhrec/(commanders|cards)/([a-z0-9-]{1,120})$")
SIM_OPP = re.compile(r"^/api/sim/opponents/([a-z0-9-]{1,130})$")
SIM_JOB = re.compile(r"^/api/sim/jobs/([0-9a-f]{12})$")


def db():
    con = sqlite3.connect(os.path.join(ARGS.data_dir, "grimorio.db"))
    con.execute("CREATE TABLE IF NOT EXISTS decks (id TEXT PRIMARY KEY, name TEXT, format TEXT,"
                " body TEXT NOT NULL, updated REAL NOT NULL)")
    con.execute("CREATE TABLE IF NOT EXISTS sim_games (id INTEGER PRIMARY KEY, ts REAL, deck_id TEXT, deck_name TEXT,"
                " format TEXT, opp_name TEXT, opp_archetype TEXT, game_no INTEGER, match_id TEXT, winner TEXT,"
                " turns INTEGER, a_side_in TEXT, a_side_out TEXT, summary TEXT)")
    # dono (login do proxy em Remote-User; sem login é o utilizador por omissão) e caixote do lixo (apagar é recuperável 30 dias)
    # sessões de testes do Laboratório guardadas no deck (séries, jogos com registo, relatório)
    con.execute("CREATE TABLE IF NOT EXISTS sim_runs (id TEXT PRIMARY KEY, deck_id TEXT, owner TEXT, ts REAL, label TEXT,"
                " summary TEXT, body TEXT NOT NULL)")
    # perfis das edições sem login (desktop): quem joga escolhe-se no browser e fica num cookie
    con.execute("CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, name TEXT, color TEXT, created REAL)")
    for col in ("owner TEXT DEFAULT 'local'", "deleted REAL"):
        try:
            con.execute(f"ALTER TABLE decks ADD COLUMN {col}")
        except sqlite3.OperationalError:
            pass
    return con


GAME_EV = {"turn", "phase", "cast", "activate", "trigger", "resolve", "life", "damage", "mill", "draw", "block", "countered",
           "destroy", "exile", "bounce", "outcome"}


def light_game(g, me="a"):
    """Jogo para as provas das trocas (gameEvidence em swap.js): o nosso lugar passa a 'a' (troca com o que lá estava)
    e os eventos ficam só com o que se lê; os que mexem cartas (terreno, ficha, zona) ficam pelo `zn` (quem está em campo)."""
    sw = lambda s: ("a" if s == me else me if s == "a" else s) if isinstance(s, str) else s  # noqa: E731
    out = []
    for e in g.get("events") or []:
        k = e.get("k")
        if k not in GAME_EV and k != "mulligan" and not e.get("zn"):
            continue
        o = {x: e[x] for x in ("t", "k", "card", "id", "n", "x", "ph", "combat") if x in e}
        for x in ("p", "target"):
            if x in e:
                o[x] = sw(e[x])
        if k in ("turn", "mulligan") and me in (e.get("hd") or {}):
            o["hd"] = {"a": e["hd"][me]}
        if e.get("zn"):
            o["zn"] = [{"id": z.get("id"), "card": z.get("card"), "from": z.get("from"), "to": z.get("to"), "fp": sw(z.get("fp")), "tp": sw(z.get("tp"))}
                       for z in e["zn"]]
        if k == "outcome":
            o["txt"] = e.get("txt") or ""  # «X has lost because …»: a via da vitória
        out.append(o)
    return {"winner": sw(g.get("winner")), "reason": g.get("reason"), "exact": bool(g.get("exact")),
            "summary": {sw(s): v for s, v in (g.get("summary") or {}).items()}, "events": out,
            **({"places": [sw(s) for s in g["places"]]} if g.get("places") else {})}


def deck_games(con, did, owner, limit=40):
    """Jogos do deck, os mais recentes primeiro: sessões do Laboratório guardadas e jogos de torneio em que esteve
    sentado (players[].src='meus', ref=did), sempre com o deck no lado 'a'."""
    out = []
    for ts, body in con.execute("SELECT ts, body FROM sim_runs WHERE deck_id=? AND owner=? ORDER BY ts DESC LIMIT 20", (did, owner)):
        for r in json.loads(body).get("runs") or []:
            for g in r.get("games") or []:
                if not g.get("crashed"):
                    out.append({"source": "lab", "ts": ts, "startLife": g.get("startLife") or 20, **light_game(g)})
        if len(out) >= limit:
            break
    seat = {}  # id do jogo -> (lado do deck, vida inicial)
    for (st,) in con.execute("SELECT state FROM tournaments WHERE owner=? ORDER BY ts DESC", (owner,)):
        st = json.loads(st)
        mine = {i for i, p in enumerate(st.get("players") or []) if p.get("src") == "meus" and p.get("ref") == did}
        if not mine:
            continue
        life = {"commander": 40, "predh": 40, "paupercommander": 30, "brawl": 25, "standardbrawl": 25}.get(st.get("format"), 20)  # baseLife (formats.js)
        for m in st.get("matches") or []:
            for x in m.get("g") or []:
                k = next((k for k, i in enumerate(x.get("s") or []) if i in mine), None)
                if k is not None and not x.get("x") and x.get("id") is not None:
                    seat[x["id"]] = (sim.SIDES[k], life)
    if seat:
        ids = list(seat)
        rows = con.execute(f"SELECT id, ts, game FROM tournament_games WHERE id IN ({','.join('?' * len(ids))}) ORDER BY ts DESC LIMIT ?",
                           (*ids, limit)).fetchall()
        for gid, ts, blob in rows:
            me, life = seat[gid]
            out.append({"source": "tournament", "ts": ts, "startLife": life, **light_game(json.loads(zlib.decompress(blob)), me)})
    return sorted(out, key=lambda g: -g["ts"])[:limit]


@functools.lru_cache(1)
def ai_flags():
    """Nomes das cartas marcadas no Forge com AI:RemoveDeck:All (lido uma vez do cardsfolder.zip). As que corrigimos
    em forge-ext/cardsfolder (build/forge/build.sh: Springleaf Drum, Signets…) já não contam: é essa a que o jogo lê."""
    out = []
    fix = os.path.join(os.path.dirname(sim.forge_dir(ARGS.data_dir)), "forge-ext", "cardsfolder")
    try:
        with zipfile.ZipFile(os.path.join(sim.forge_dir(ARGS.data_dir), "res", "cardsfolder", "cardsfolder.zip")) as z:
            for n in z.namelist():
                if os.path.isfile(os.path.join(fix, n)):
                    continue
                t = z.read(n).decode("utf-8", "ignore")
                if "AI:RemoveDeck:All" in t:
                    m = re.search(r"^Name:(.+)$", t, re.M)
                    if m:
                        out.append(m.group(1).strip())
    except (OSError, zipfile.BadZipFile):
        pass
    return sorted(out)


def update_state(raw=False):
    """O que o launcher dos pacotes escreveu em <data>/update.json, mais a versão que está a correr."""
    try:
        with open(os.path.join(ARGS.data_dir, "update.json"), encoding="utf-8") as f:
            st = json.load(f)
    except (OSError, ValueError):
        st = {}
    if raw:
        return st
    ver = os.environ.get("GRIMORIO_VERSION")
    return {"version": ver, "packaged": bool(ver and ver != "dev"), "auto": st.get("auto") is not False, "latest": st.get("latest"),
            "ready": st.get("ready") if st.get("ready") and st.get("ready") != ver else None, "downloading": st.get("downloading"),
            "err": st.get("err"), "checked": st.get("checked"), "url": st.get("url")}


class H(BaseHTTPRequestHandler):
    server_version = "Grimorio/1.0"

    def log_message(self, *a):
        pass

    def send(self, code, body=b"", ctype="application/json", headers=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def json(self, obj, code=200):
        self.send(code, json.dumps(obj, ensure_ascii=False).encode())

    def file(self, path, cache):
        if not os.path.isfile(path):
            return self.send(404, b"nao existe", "text/plain")
        st = os.stat(path)
        etag = f'"{int(st.st_mtime)}-{st.st_size}"'
        if self.headers.get("If-None-Match") == etag:
            return self.send(304, headers={"ETag": etag})
        headers = {"ETag": etag, "Cache-Control": cache}
        ctype = TYPES.get(os.path.splitext(path)[1], "application/octet-stream")
        gz = path + ".gz"
        if os.path.isfile(gz) and "gzip" in self.headers.get("Accept-Encoding", ""):
            path, headers["Content-Encoding"] = gz, "gzip"
        with open(path, "rb") as f:
            self.send(200, f.read(), ctype, headers)

    def do_HEAD(self):
        self.do_GET()

    # entrada única: convite, convidado (lista fechada em guests.py) ou dono
    _as_guest = None

    def guest(self):
        tok = guests.cookie_token(self.headers)
        if not tok:
            return None
        with db() as con:
            return guests.by_token(con, tok)

    def _route(self, method, inner):
        p = self.path.split("?")[0]
        if method == "GET" and p.startswith("/sala/"):  # link de uma sala: entra quem não está nos amigos (pede o nome)
            with db() as con:
                return guests.room_link(self, con, p[len("/sala/"):], urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).get("nome", [""])[0])
        if method == "GET" and p.startswith("/convite/"):
            with db() as con:
                return guests.accept(self, con, p[len("/convite/"):])
        g = self.guest()
        if g:
            self._as_guest = g
            return guests.handle(self, method, g, db, tournament)
        if p == "/api/guest/me":  # a app pergunta se é convidada; com um convite revogado diz-lho
            return self.json({"guest": None, "expired": bool(guests.cookie_token(self.headers)), "guestHost": guests.is_guest_host(self.headers)})
        if guests.is_guest_host(self.headers) and not guests.public_ok(method, p):
            return self.json({"erro": "Precisas de um convite para entrar.", "code": "invite"}, 403)
        if p.startswith("/api/share") and method in ("GET", "POST"):  # partilhar pela internet (túnel da Cloudflare)
            return self.json(*reversed(share.route(method, p, ARGS.data_dir, ARGS.port)))
        if p.startswith("/api/rooms") and method in ("GET", "POST"):  # salas de torneio com amigos (rooms.py)
            body = self.body() if method == "POST" else None
            with db() as con:
                return self.json(*reversed(rooms.route(con, method, p, self.owner(), body)))
        if p.startswith("/api/friends") and method != "HEAD":  # o dono gere os amigos
            body = self.body() if method in ("POST",) and not p.endswith("/revoke") else None
            with db() as con:
                return self.json(*reversed(guests.owner_route(con, method, p, self.owner(), body, ARGS.port, share.status()["url"], getattr(ARGS, "host", "0.0.0.0"))))
        return inner()

    def do_GET(self):
        return self._route("GET", self._get)

    def do_POST(self):
        return self._route("POST", self._post)

    def do_PUT(self):
        return self._route("PUT", self._put)

    def do_DELETE(self):
        return self._route("DELETE", self._delete)

    def _get(self):
        p = self.path.split("?")[0]
        if p == "/api/profiles":
            return self.profiles_route("GET")
        if p in ("/api/backup/export", "/api/sync"):  # cópias e sincronização por pasta (backup.py)
            return backup.http(self, "GET", p, ARGS.data_dir)
        if self.no_profile():
            return
        if p == "/play/ws":  # jogar contra o Forge: websocket do noVNC -> VNC do contentor (play.py)
            return play.ws_bridge(self)
        if p.startswith("/play/novnc/"):  # cliente noVNC (build/play/build.sh põe-no em <data>/novnc)
            root = os.path.realpath(os.path.join(ARGS.data_dir, "novnc"))
            f = os.path.realpath(os.path.join(root, p[len("/play/novnc/"):]))
            return self.file(f, "no-cache") if f.startswith(root + os.sep) else self.send(404, b"nao existe", "text/plain")
        if p == "/api/play/status":
            return self.json(play.status())
        if p.startswith("/api/playnet"):
            return self.playnet_route("GET")
        if p.startswith("/api/limited"):
            return self.limited_route("GET")
        if p == "/api/update":  # pacotes (exe/Linux): versão, a nova e o estado da atualização automática (launcher.py)
            return self.json(update_state())
        m = EDHREC_PATH.match(p)
        if m:
            return self.edhrec(m.group(1), m.group(2))
        ml = L17_PATH.match(p)
        if ml:  # 17lands (o browser não pode pedir a lista de sets por CORS); cache de 1 dia
            return self.l17(ml.group(1))
        mm = META_PATH.match(p)
        if mm:  # meta de torneios (build/meta_mtgtop8.py)
            return self.file(os.path.join(ARGS.data_dir, "meta", f"{mm.group(1)}.json"), "no-cache")
        if p == "/api/rules":  # biblioteca de regras (rules.py)
            return self.json(*reversed(rules.route(self.path, ARGS.data_dir)))
        if p == "/api/ia/config":
            return self.json(ia.public_config(ARGS.data_dir))
        if p == "/api/ia/models":  # modelos mais recentes do fornecedor (pela chave guardada)
            try:
                return self.json(ia.models(ARGS.data_dir, urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).get("provider", [""])[0]))
            except ValueError as e:
                return self.json({"erro": str(e)}, 400)
            except RuntimeError as e:
                return self.json({"erro": str(e)}, 502)
        if p.startswith("/api/sim/"):  # laboratório de testes (sim.py)
            q = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
            m = SIM_JOB.match(p) or SIM_OPP.match(p)
            if p == "/api/sim/active":  # os meus jogos do Laboratório a decorrer (qualquer separador/dispositivo)
                return self.json(sim.active(self.owner()))
            if p == "/api/sim/aiflags":  # cartas que o próprio Forge diz que a IA joga mal (AI:RemoveDeck:All)
                return self.json(ai_flags())
            if p == "/api/sim/settings":  # jogos do Forge em simultâneo
                return self.json(sim.settings(ARGS.data_dir))
            if p == "/api/sim/difficulties":
                return self.json([{"id": i, "label": l, "description": d} for i, _, l, d in sim.DIFFICULTIES])
            if p == "/api/sim/opponents":
                return self.json(sim.opponents(ARGS.data_dir, q.get("format", [""])[0]))
            if p == "/api/sim/runs":
                with db() as con:
                    rows = con.execute("SELECT id, ts, label, summary FROM sim_runs WHERE deck_id=? AND owner=? ORDER BY ts DESC",
                                       (q.get("deck_id", [""])[0], self.owner())).fetchall()
                return self.json([{"id": r[0], "ts": r[1], "label": r[2], "summary": json.loads(r[3] or "{}")} for r in rows])
            mr = re.match(r"^/api/sim/runs/([a-f0-9-]{8,40})$", p)
            if mr:
                with db() as con:
                    r = con.execute("SELECT body FROM sim_runs WHERE id=? AND owner=?", (mr.group(1), self.owner())).fetchone()
                return self.send(200, r[0].encode()) if r else self.json({"erro": "não existe"}, 404)
            if p == "/api/sim/history":
                with db() as con:
                    return self.json(sim.history(con, q.get("deck_id", [""])[0]))
            r = m and (sim.status(m.group(1)) if p.startswith("/api/sim/jobs/") else sim.opponent(ARGS.data_dir, m.group(1)))
            return self.json(r) if r else self.json({"erro": "não existe"}, 404)
        if p == "/api/import/profile":  # perfil -> lista de decks públicos para escolher
            url = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).get("url", [""])[0]
            try:
                return self.json({"decks": list_profile(url)})
            except ValueError as e:
                return self.json({"erro": str(e)}, 400)
            except Exception as e:
                return self.json({"erro": str(e) if isinstance(e, UpstreamError) else "O site devolveu uma resposta inesperada."}, 502)
        if p == "/api/search/decks":  # decks públicos (Archidekt) com filtros -> {count, next, decks}
            q = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
            g = lambda k: q.get(k, [""])[0]
            try:
                return self.json(search_decks(g("q"), g("format"), g("colors"), g("card"), g("order") or "vistos", g("page") or 1))
            except Exception as e:
                return self.json({"erro": str(e) if isinstance(e, UpstreamError) else "O Archidekt devolveu uma resposta inesperada."}, 502)
        if p == "/api/import":  # deck a partir do URL de um site -> {name, format, source, text}
            url = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).get("url", [""])[0]
            try:
                return self.json(fetch_deck(url))
            except ValueError as e:
                return self.json({"erro": str(e)}, 400)
            except Exception as e:  # rede, Cloudflare, resposta inesperada do site
                msg = str(e) if isinstance(e, UpstreamError) else "O site devolveu uma resposta inesperada."
                return self.json({"erro": msg}, 502)
        if p == "/api/health":
            ok = os.path.isfile(os.path.join(ARGS.data_dir, "data", "meta.json"))
            return self.json({"ok": ok}, 200 if ok else 503)
        if p == "/api/arts/proxy":  # imagem de uma pasta na net, para o browser a comprimir antes de a guardar (artfolder.py)
            if not self.owner():
                return self.json({"erro": "sem utilizador"}, 401)
            try:
                body, ctype = artfolder.fetch(urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).get("url", [""])[0])
            except ValueError as e:
                return self.json({"erro": str(e)}, 400)
            except Exception:
                return self.json({"erro": "Não consegui trazer essa imagem."}, 502)
            return self.send(200, body, ctype, {"Cache-Control": "private, max-age=600"})
        ma = re.match(r"^/arts/([a-f0-9]{20}\.(?:jpg|png|webp|gif))$", p)  # imagens próprias das cartas (POST /api/arts)
        if ma:
            return self.file(os.path.join(ARGS.data_dir, "arts", ma.group(1)), "max-age=31536000, immutable")
        mc = re.match(r"^/covers/([a-z0-9-]{8,40}\.(?:jpg|png|webp|gif))$", p)
        if mc:  # capas próprias dos decks (carregadas pelo dono)
            return self.file(os.path.join(ARGS.data_dir, "covers", mc.group(1)), "max-age=31536000")
        if p.startswith("/data/"):
            name = os.path.basename(p)
            return self.file(os.path.join(ARGS.data_dir, "data", name), "no-cache")
        if p.startswith("/api/tournaments"):  # torneios (tournament.py)
            return self.json(*reversed(tournament.route("GET", p, self.owner())))
        if p.startswith(("/api/ratings", "/api/arena")):  # ratings dos decks e Arena automática (ratings.py)
            return self.json(*reversed(ratings.route("GET", self.path, self.owner())))
        if p in ("/api/decks", "/api/decks/trash"):
            trash = p.endswith("trash")
            with db() as con:
                con.execute("DELETE FROM decks WHERE deleted IS NOT NULL AND deleted < ?", (time.time() - 30 * 86400,))
                rows = con.execute("SELECT id, name, format, updated, body, deleted FROM decks WHERE owner=? AND deleted IS "
                                   + ("NOT NULL" if trash else "NULL") + " ORDER BY updated DESC", (self.owner(),)).fetchall()
            out = []
            for r in rows:  # resumo para a caixa do deck: capa, comandantes e lista (as cores calculam-se no browser)
                d = json.loads(r[4])
                if self._as_guest and d.get("friend") != self._as_guest["id"]:
                    continue  # convidado: só os decks dele
                out.append({"id": r[0], "name": r[1], "format": r[2], "updated": r[3], "deleted": r[5], "count": d.get("count", 0), "created": d.get("created") or r[3], "community": bool(d.get("community")), **({"friend": d["friend"], "friendName": d.get("friendName")} if d.get("friend") else {}),
                            "cover": d.get("cover"), "coverImg": d.get("coverImg"), "fav": bool(d.get("fav")), "casual": bool(d.get("casual")), "commanders": d.get("commanders") or [], "seeds": (d.get("seeds") or [])[:3],
                            "main": d.get("main") or {}, **({"art": d["art"]} if d.get("art") else {})})  # artes próprias (capa)
            return self.json(out)
        if p == "/api/me":  # nome para mostrar (o do perfil, nunca o id interno)
            return self.json({"user": (self.profile() or {}).get("name") if self.mode() == "profiles" else self.owner()})
        mg = re.match(r"^/api/decks/([a-z0-9-]{8,40})/games$", p)
        if mg:  # jogos do deck (Laboratório + torneios, o deck sempre em 'a') para as provas das trocas (swap.js)
            try:
                self.own_deck(mg.group(1))
            except ValueError:
                return self.json({"erro": "deck não existe"}, 404)
            q = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
            n = q.get("limit", ["40"])[0]
            n = min(200, int(n)) if n.isdigit() and int(n) > 0 else 40
            with db() as con:
                return self.json(deck_games(con, mg.group(1), self.owner(), n))
        mrec = re.match(r"^/api/decks/([a-z0-9-]{8,40})/record$", p)
        if mrec:  # Análise: contra quem ganhou e perdeu, dano feito/levado e as cartas que mais dano fazem (ratings.py)
            with db() as con:
                r = ratings.deck_record(con, mrec.group(1), self.owner())
            return self.json(r) if r else self.json({"erro": "deck não existe"}, 404)
        if p.startswith("/api/decks/"):
            did = p.rsplit("/", 1)[1]
            with db() as con:
                r = con.execute("SELECT body FROM decks WHERE id=? AND owner=?", (did, self.owner())).fetchone()
                return self.json(with_rated(con, did, json.loads(r[0]))) if r else self.json({"erro": "deck não existe"}, 404)
        if p.startswith("/assets/"):
            return self.file(os.path.join(DIST, p.lstrip("/")), "public, max-age=31536000, immutable")
        rel = p.lstrip("/")
        if rel and os.path.isfile(os.path.join(DIST, rel)):
            return self.file(os.path.join(DIST, rel), "no-cache")
        return self.file(os.path.join(DIST, "index.html"), "no-cache")

    def l17(self, what):
        cache_dir = os.path.join(ARGS.data_dir, "l17")
        os.makedirs(cache_dir, exist_ok=True)
        path = os.path.join(cache_dir, what.replace("/", "-") + ".json")
        if not (os.path.isfile(path) and time.time() - os.path.getmtime(path) < 86400):
            url = "https://www.17lands.com/data/expansions" if what == "expansions" else \
                f"https://www.17lands.com/card_ratings/data?expansion={what.split('/')[1]}&format=PremierDraft"
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Grimorio/1.0 (uso pessoal)"})
                with urllib.request.urlopen(req, timeout=20) as r:
                    body = r.read(10_000_000)
                json.loads(body)
                with open(path, "wb") as f:
                    f.write(body)
            except Exception:
                if not os.path.isfile(path):
                    return self.json([], 200)
        with open(path, "rb") as f:
            return self.send(200, f.read())

    def edhrec(self, kind, slug):
        """Co-ocorrência em decks reais (EDHREC), reduzida e guardada 7 dias em disco.
        Devolve {decks, cards: [[nome, num_decks, potential_decks, lift, synergy]]}."""
        cache_dir = os.path.join(ARGS.data_dir, "edhrec")
        os.makedirs(cache_dir, exist_ok=True)
        path = os.path.join(cache_dir, f"{kind}-{slug}.json")
        if os.path.isfile(path) and time.time() - os.path.getmtime(path) < 7 * 86400:
            with open(path, "rb") as f:
                return self.send(200, f.read())
        try:
            req = urllib.request.Request(f"https://json.edhrec.com/pages/{kind}/{slug}.json",
                                         headers={"User-Agent": "Grimorio/1.0 (uso pessoal)"})
            with urllib.request.urlopen(req, timeout=15) as r:
                d = json.load(r)
        except urllib.error.HTTPError as e:
            out = json.dumps({"decks": 0, "cards": [], "erro": e.code}).encode()
            if e.code == 404:  # carta sem página: guardar o vazio para não voltar a perguntar
                with open(path, "wb") as f:
                    f.write(out)
            return self.send(200, out)
        except Exception as e:  # sem rede: as sugestões seguem sem este sinal
            return self.json({"decks": 0, "cards": [], "erro": str(e)[:100]})
        seen, cards = set(), []
        for lst in d.get("container", {}).get("json_dict", {}).get("cardlists", []):
            for cv in lst.get("cardviews", []):
                if cv.get("name") in seen or "num_decks" not in cv:
                    continue
                seen.add(cv["name"])
                cards.append([cv["name"], cv["num_decks"], cv.get("potential_decks") or 0,
                              round(cv.get("lift") or 0, 3), round(cv.get("synergy") or 0, 3)])
        decks = max((c[2] for c in cards), default=0) if kind == "commanders" else 0
        out = json.dumps({"decks": d.get("num_decks_avg") or decks, "cards": cards}, ensure_ascii=False).encode()
        with open(path, "wb") as f:
            f.write(out)
        return self.send(200, out)

    def body(self, limit=2_000_000):
        n = int(self.headers.get("Content-Length") or 0)
        if n > limit:
            raise ValueError("deck grande demais")
        return json.loads(self.rfile.read(n) or b"{}")

    def own_deck(self, did):
        with db() as con:
            r = con.execute("SELECT body FROM decks WHERE id=? AND owner=?", (str(did), self.owner())).fetchone()
        if not r:
            raise ValueError("Esse deck não existe.")
        return json.loads(r[0])

    def play_route(self):
        """POST /api/play/start {deck_id|deck, opponent: {id}|{deck_id}|{deck}, format, difficulty} -> {session, url};
        /api/play/from-state {state, control, format, difficulty}; /api/play/stop."""
        if self.path == "/api/play/stop":
            with play.LOCK:
                return self.json(play.stop())
        try:
            d = self.body()
            if self.path == "/api/play/from-state":
                return self.json(play.from_state(ARGS.data_dir, d, self.owner()), 201)
            a = self.own_deck(d["deck_id"]) if d.get("deck_id") else d.get("deck")
            o = d.get("opponent") or {}
            b = o.get("deck") or (self.own_deck(o["deck_id"]) if o.get("deck_id") else
                                  sim.opponent(ARGS.data_dir, str(o.get("id") or "")))
            if not b:
                raise ValueError("Adversário desconhecido.")
            return self.json(play.start(ARGS.data_dir, {**d, "a": a, "b": b}, self.owner()), 201)
        except (ValueError, TypeError, AttributeError, KeyError) as e:
            return self.json({"erro": str(e) if isinstance(e, ValueError) else "pedido inválido"}, 400)
        except RuntimeError as e:
            return self.json({"erro": str(e)}, 409)

    def playnet_route(self, method):
        """Forge Play nativo (playnet.py). POST /api/playnet {deck_id|deck, opponent: {id}|{deck_id}|{deck}, difficulty} -> {id};
        GET /api/playnet -> jogos meus; GET /api/playnet/<id>?since=N (espera até 20 s por novidades);
        POST /api/playnet/<id>/cmd {c, …}; POST /api/playnet/<id>/stop."""
        u = urllib.parse.urlsplit(self.path)
        m = re.fullmatch(r"/api/playnet(?:/([a-f0-9]{12})(?:/(cmd|stop))?)?", u.path)
        if not m:
            return self.json({"erro": "rota desconhecida"}, 404)
        sid, act, owner = m.group(1), m.group(2), self.owner()
        try:
            if method == "GET" and not sid:
                return self.json(playnet.active(owner))
            if method == "GET" and not act:
                since = int((urllib.parse.parse_qs(u.query).get("since") or ["0"])[0] or 0)
                return self.json(playnet.poll(sid, owner, since))
            if method != "POST":
                return self.json({"erro": "rota desconhecida"}, 404)
            d = self.body() or {}
            if not sid:
                a = self.own_deck(d["deck_id"]) if d.get("deck_id") else d.get("deck")
                o = d.get("opponent") or {}
                b = o.get("deck") or (self.own_deck(o["deck_id"]) if o.get("deck_id") else sim.opponent(ARGS.data_dir, str(o.get("id") or "")))
                if not a or not b:
                    raise ValueError("Falta um dos decks.")
                if d.get("casual"):  # modo casual: decks de qualquer formato, 1 contra 1; o comandante joga como carta do deck
                    a, b = ({**x, "main": {**(x.get("main") or {}), **{c: 1 for c in x.get("commanders") or []}}, "commanders": []} for x in (a, b))
                prof = self.profile()
                return self.json({"id": playnet.start(ARGS.data_dir, owner, a, b, str(d.get("difficulty") or "default"), (prof or {}).get("name") or str(d.get("name") or "")[:30] or "Tu")}, 201)
            if act == "cmd":
                playnet.cmd(sid, owner, d)
                return self.json({"ok": True})
            if act == "stop":
                playnet.stop(sid, owner)
                return self.json({"ok": True})
            return self.json({"erro": "rota desconhecida"}, 404)
        except KeyError:
            return self.json({"erro": "Esse jogo já não existe."}, 404)
        except (ValueError, TypeError, AttributeError) as e:
            return self.json({"erro": str(e) if isinstance(e, ValueError) else "pedido inválido"}, 400)

    def limited_route(self, method):
        """Limitado (limited.py). GET /api/limited -> eventos meus; GET /api/limited/sets; POST /api/limited {kind, sets, human,
        players} -> {id}; GET /api/limited/<id>?since=N (espera até 20 s pelo pack seguinte); GET /api/limited/<id>/event;
        POST /api/limited/<id>/pick {i} | /stop | /deck (o teu pool vira um deck Limitado) | /tournament {type, bo, difficulty}."""
        u = urllib.parse.urlsplit(self.path)
        m = re.fullmatch(r"/api/limited(?:/(sets|[a-f0-9]{12})(?:/(pick|stop|deck|tournament|event))?)?", u.path)
        if not m:
            return self.json({"erro": "rota desconhecida"}, 404)
        eid, act, owner, D = m.group(1), m.group(2), self.owner(), ARGS.data_dir
        try:
            if method == "GET":
                if not eid:
                    return self.json(limited.events(D, owner))
                if eid == "sets":
                    return self.json(limited.sets(D))
                if act == "event":
                    return self.json(limited.load(D, eid, owner))
                if not act:
                    since = int((urllib.parse.parse_qs(u.query).get("since") or ["0"])[0] or 0)
                    try:
                        return self.json(limited.poll(eid, owner, since))
                    except KeyError:  # já não está em memória (acabou ou o servidor reiniciou): o que ficou gravado
                        ev = limited.load(D, eid, owner)
                        return self.json({"seq": since + 1, "pack": None, "ended": True, "status": ev["status"], "error": ev.get("error")})
                return self.json({"erro": "rota desconhecida"}, 404)
            d = self.body() or {}
            if not eid:
                return self.json({"id": limited.start(D, owner, d.get("kind"), d.get("sets") or [], d.get("human", True) is not False, d.get("players") or 8)}, 201)
            if act == "pick":
                limited.pick(eid, owner, int(d.get("i")))
                return self.json({"ok": True})
            if act == "stop":
                limited.stop(eid, owner)
                return self.json({"ok": True})
            ev = limited.load(D, eid, owner)
            if ev["status"] not in ("built", "tournament"):
                raise ValueError("O draft ainda não acabou.")
            if act == "deck":  # o teu pool num deck Limitado (o deck sugerido pelo Forge no main, o resto no sideboard)
                if ev.get("deck_id"):
                    with db() as con:
                        if con.execute("SELECT 1 FROM decks WHERE id=? AND owner=? AND deleted IS NULL", (ev["deck_id"], owner)).fetchone():
                            return self.json({"deck_id": ev["deck_id"]})
                title = "Draft" if ev["kind"] == "draft" else "Selado"
                dk = limited.deck_of(ev, 0, f"{title} {'/'.join(dict.fromkeys(ev['sets']))} · {time.strftime('%d/%m')}")
                now = time.time()
                dk.update(id=uuid.uuid4().hex, created=now, updated=now, notes="", limited=eid)
                with db() as con:
                    con.execute("INSERT INTO decks (id, name, format, body, updated, owner, deleted) VALUES (?,?,?,?,?,?,NULL)",
                                (dk["id"], dk["name"][:200], "limited", json.dumps(dk, ensure_ascii=False), now, owner))
                ev["deck_id"] = dk["id"]
                limited.save(D, ev)
                return self.json({"deck_id": dk["id"]}, 201)
            if act == "tournament":
                seats = range(1 if ev["human"] else 0, len(ev["players"]))
                ps = [{"src": "meus", "ref": ev["deck_id"], "me": True}] if ev["human"] else []
                if ev["human"] and not ev.get("deck_id"):
                    raise ValueError("Primeiro guarda o teu deck.")
                diff = str(d.get("difficulty") or "default")
                ps += [{"src": "draft", "ref": f"{eid}:{i}", "difficulty": diff, "colors": limited.colors(ev, i)} for i in seats]
                title = "Draft" if ev["kind"] == "draft" else "Selado"
                tid = tournament.create(owner, {"type": d.get("type") or "suico", "format": "limited", "players": ps, "bo": d.get("bo") or 1,
                                                "name": f"{title} {'/'.join(dict.fromkeys(ev['sets']))}", "rounds": d.get("rounds")})
                ev.update(status="tournament", tid=tid)
                limited.save(D, ev)
                return self.json({"tid": tid}, 201)
            return self.json({"erro": "rota desconhecida"}, 404)
        except KeyError:
            return self.json({"erro": "Esse draft já não existe."}, 404)
        except (ValueError, TypeError, AttributeError) as e:
            return self.json({"erro": str(e) if isinstance(e, ValueError) else "pedido inválido"}, 400)

    def _post(self):
        if self.path.startswith("/api/profiles"):
            return self.profiles_route("POST")
        if self.path.startswith(("/api/backup/", "/api/sync")):
            return backup.http(self, "POST", self.path, ARGS.data_dir)
        if self.no_profile():
            return
        if self.path.startswith("/api/tournaments"):
            try:
                d = self.body()
            except ValueError as e:
                return self.json({"erro": str(e)}, 400)
            return self.json(*reversed(tournament.route("POST", self.path, self.owner(), d)))
        if self.path in ("/api/arena", "/api/ratings/reset-all"):
            try:
                d = self.body()
            except ValueError as e:
                return self.json({"erro": str(e)}, 400)
            return self.json(*reversed(ratings.route("POST", self.path, self.owner(), d)))
        if self.path in ("/api/play/start", "/api/play/from-state", "/api/play/stop"):
            return self.play_route()
        if self.path.startswith("/api/playnet"):
            return self.playnet_route("POST")
        if self.path.startswith("/api/limited"):
            return self.limited_route("POST")
        if self.path == "/api/update":  # {auto: true|false}: atualizar sozinho (o launcher lê-o ao arrancar)
            try:
                auto = bool((self.body() or {}).get("auto"))
            except ValueError as e:
                return self.json({"erro": str(e)}, 400)
            p = os.path.join(ARGS.data_dir, "update.json")
            st = update_state(raw=True)
            st["auto"] = auto
            with open(p + ".tmp", "w", encoding="utf-8") as f:
                json.dump(st, f)
            os.replace(p + ".tmp", p)
            return self.json(update_state())
        if self.path in ("/api/ia/config", "/api/ia/ask"):
            try:
                d = self.body()
                if self.path == "/api/ia/config":
                    return self.json(ia.save(ARGS.data_dir, d))
                return self.json(ia.ask(ARGS.data_dir, d))
            except ValueError as e:
                return self.json({"erro": str(e)}, 400)
            except RuntimeError as e:
                return self.json({"erro": str(e)}, 502)
        if self.path == "/api/sim/runs":  # guardar uma sessão de testes no deck
            try:
                d = self.body(20_000_000)
            except ValueError as e:
                return self.json({"erro": str(e)}, 400)
            rid = str(uuid.uuid4())
            with db() as con:
                con.execute("INSERT INTO sim_runs VALUES (?,?,?,?,?,?,?)", (rid, str(d.get("deck_id") or ""), self.owner(), time.time(),
                            str(d.get("label") or "")[:200], json.dumps(d.get("summary") or {}), json.dumps(d, ensure_ascii=False)))
            return self.json({"id": rid}, 201)
        if self.path == "/api/sim/settings":
            try:
                return self.json(sim.settings(ARGS.data_dir, self.body()))
            except (ValueError, TypeError) as e:
                return self.json({"erro": str(e) or "pedido inválido"}, 400)
        mc = re.match(r"^/api/sim/jobs/([a-f0-9]{12})/cancel$", self.path)
        if mc:  # «Parar» do Laboratório: tira da fila ou mata o jogo a decorrer (o resto da sessão fica guardado no browser)
            if not self.owner():
                return self.json({"erro": "sem utilizador"}, 401)
            sim.cancel(mc.group(1))
            return self.json({"ok": True})
        if self.path in ("/api/sim/run", "/api/sim/record"):
            try:
                d = self.body()
                if self.path == "/api/sim/run":
                    if play.status().get("running"):  # a RAM não chega para um jogo teu no Forge e testes ao mesmo tempo
                        return self.json({"erro": "Há um jogo teu aberto contra o Forge (Coliseu › Jogar). Pára-o antes de correr testes."}, 409)
                    return self.json({"job": sim.submit(ARGS.data_dir, {**d, "_src": "lab", "_owner": self.owner()})}, 202)
                with db() as con:
                    rid = sim.record(con, d)
                    ratings.from_lab(con, d, self.owner())  # 1 contra 1 com opp_key: conta para os ratings
                    return self.json({"id": rid}, 201)
            except (ValueError, TypeError, AttributeError) as e:
                return self.json({"erro": str(e) if isinstance(e, ValueError) else "pedido inválido"}, 400)
        if self.path == "/api/proxies.zip":  # imagens do deck para gráficas de proxies (artfolder.proxies_zip)
            if not self.owner():
                return self.json({"erro": "sem utilizador"}, 401)
            try:
                b = self.body(1_000_000)
                data, missed = artfolder.proxies_zip(b.get("items") or [], os.path.join(ARGS.data_dir, "arts"), str(b.get("list") or ""), bool(b.get("perCopy")))
            except ValueError as e:
                return self.json({"erro": str(e)}, 400)
            except Exception:
                return self.json({"erro": "Não consegui juntar as imagens (a Scryfall ou um dos links não respondeu)."}, 502)
            name = re.sub(r"[^\w\- ]+", "", str(b.get("name") or "deck"))[:60] or "deck"
            return self.send(200, data, "application/zip", {"Content-Disposition": f'attachment; filename="{name} - proxies.zip"', "X-Missed": str(len(missed))})
        if self.path == "/api/arts/folder":  # lista as imagens de uma pasta na net: {url} → [{name, url}] (artfolder.py)
            if not self.owner():
                return self.json({"erro": "sem utilizador"}, 401)
            try:
                return self.json(artfolder.listing(str((self.body() or {}).get("url") or "")))
            except ValueError as e:
                return self.json({"erro": str(e)}, 400)
            except Exception:
                return self.json({"erro": "Não consegui abrir esse link."}, 502)
        if self.path == "/api/arts":  # imagem própria de uma carta: guarda-se pelo conteúdo e devolve o link relativo
            if not self.owner():
                return self.json({"erro": "sem utilizador"}, 401)
            ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif"}.get((self.headers.get("Content-Type") or "").split(";")[0].strip().lower())
            n = int(self.headers.get("Content-Length") or 0)
            if not ext or not 0 < n <= 6_000_000:
                return self.json({"erro": "A imagem tem de ser jpg, png, webp ou gif até 6 MB."}, 400)
            data = self.rfile.read(n)
            name = f"{hashlib.sha1(data).hexdigest()[:20]}.{ext}"
            adir = os.path.join(ARGS.data_dir, "arts")
            os.makedirs(adir, exist_ok=True)
            if not os.path.exists(os.path.join(adir, name)):
                with open(os.path.join(adir, name), "wb") as f:
                    f.write(data)
            return self.json({"url": f"arts/{name}"}, 201)
        m = re.match(r"^/api/decks/([a-z0-9-]{8,40})/cover$", self.path)
        if m:  # capa própria: imagem no corpo (jpg/png/webp/gif até 6 MB) ou {"url": "https://…"}; {"url": null} tira-a
            did, ct = m.group(1), (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            with db() as con:
                r = con.execute("SELECT body FROM decks WHERE id=? AND owner=?", (did, self.owner())).fetchone()
            if not r:
                return self.json({"erro": "deck não existe"}, 404)
            d, cdir = json.loads(r[0]), os.path.join(ARGS.data_dir, "covers")
            ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif"}.get(ct)
            if ext:
                n = int(self.headers.get("Content-Length") or 0)
                if not 0 < n <= 6_000_000:
                    return self.json({"erro": "A imagem tem de ter até 6 MB."}, 400)
                img = self.rfile.read(n)
            else:
                try:
                    url = str(self.body().get("url") or "").strip()
                except (ValueError, AttributeError):
                    return self.json({"erro": "pedido inválido"}, 400)
                if url and not re.match(r"^https://[^\s\"'<>]{4,1000}$", url):
                    return self.json({"erro": "O link da imagem tem de começar por https://"}, 400)
            for old in os.listdir(cdir) if os.path.isdir(cdir) else []:
                if old.startswith(did + "."):
                    os.remove(os.path.join(cdir, old))
            if ext:
                os.makedirs(cdir, exist_ok=True)
                with open(os.path.join(cdir, f"{did}.{ext}"), "wb") as f:
                    f.write(img)
                d["coverImg"] = f"covers/{did}.{ext}?v={int(time.time())}"
            else:
                d["coverImg"] = url or None
            with db() as con:
                con.execute("UPDATE decks SET body=? WHERE id=? AND owner=?", (json.dumps(d, ensure_ascii=False), did, self.owner()))
            return self.json({"coverImg": d["coverImg"]})
        m = re.match(r"^/api/decks/([a-z0-9-]{8,40})/restore$", self.path)
        if m:
            with db() as con:
                n = con.execute("UPDATE decks SET deleted=NULL, updated=? WHERE id=? AND owner=?", (time.time(), m.group(1), self.owner())).rowcount
            return self.json({"ok": bool(n)}, 200 if n else 404)
        if self.path != "/api/decks":
            return self.json({"erro": "rota desconhecida"}, 404)
        try:
            d = self.body()
        except ValueError as e:
            return self.json({"erro": str(e)}, 400)
        d["id"] = str(uuid.uuid4())
        return self.save(d, 201)

    def _put(self):
        if self.path.startswith("/api/profiles"):
            return self.profiles_route("PUT")
        if self.no_profile():
            return
        did = self.path.split("?")[0].rsplit("/", 1)[1]
        if not self.path.startswith("/api/decks/") or not DECK_ID.match(did):
            return self.json({"erro": "rota desconhecida"}, 404)
        try:
            d = self.body()
        except ValueError as e:
            return self.json({"erro": str(e)}, 400)
        d["id"] = did
        return self.save(d, 200)

    def save(self, d, code):
        if not isinstance(d, dict) or not isinstance(d.get("main", {}), dict):
            return self.json({"erro": "deck inválido"}, 400)
        d["updated"] = time.time()
        with db() as con:
            r = con.execute("SELECT owner, body FROM decks WHERE id=?", (d["id"],)).fetchone()
            if r and r[0] != self.owner():
                return self.json({"erro": "este deck é de outro utilizador"}, 403)
            for k in ("cover", "coverImg", "art"):  # o editor pode guardar uma cópia antiga: a capa e as artes do site mantêm-se
                if r and k not in d and json.loads(r[1]).get(k):
                    d[k] = json.loads(r[1])[k]
            d["created"] = (r and json.loads(r[1]).get("created")) or d["updated"]  # data de criação: a da 1.ª gravação, nunca muda
            # ratings presos à lista: se mudar mais de 10% da lista de referência, recomeçam do zero (o editor avisa antes)
            d.pop("rated", None)
            reset = False
            if r and ratings.rated(con, f"deck:{d['id']}"):
                base = with_rated(con, d["id"], json.loads(r[1]))["rated"]["list"]
                if tournament.similarity(base, rated_list(d)) < tournament.SAME:
                    ratings.reset(con, f"deck:{d['id']}")
                    reset = True
                else:
                    d["rated"] = {"list": base}
            con.execute("INSERT OR REPLACE INTO decks (id, name, format, body, updated, owner, deleted) VALUES (?,?,?,?,?,?,NULL)",
                        (d["id"], str(d.get("name", ""))[:200], str(d.get("format", ""))[:40],
                         json.dumps(d, ensure_ascii=False), d["updated"], self.owner()))
        return self.json({**d, **({"rated_reset": True} if reset else {})}, code)

    def owner(self):
        if self._as_guest:  # convidado: os dados vivem no espaço do anfitrião que o convidou
            return self._as_guest["owner"]
        # 1) login do proxy (Caddy + Authelia) em Remote-User; 2) --owner/GRIMORIO_OWNER fixo; 3) perfil do cookie (None sem perfil)
        if self.mode() != "profiles":
            return (self.headers.get("Remote-User") or ARGS.owner).strip()[:64]
        p = self.profile()
        return p and p["id"]

    def mode(self):
        return "login" if (self.headers.get("Remote-User") or "").strip() else "fixed" if ARGS.owner else "profiles"

    def profile(self):
        c = http.cookies.SimpleCookie()
        try:
            c.load(self.headers.get("Cookie") or "")
        except http.cookies.CookieError:
            return None
        pid = c["grimorio_profile"].value if "grimorio_profile" in c else ""
        with db() as con:
            r = con.execute("SELECT id, name, color FROM profiles WHERE id=?", (pid,)).fetchone() if pid else None
        return r and {"id": r[0], "name": r[1], "color": r[2]}

    # rotas que precisam de saber de quem são os dados: sem perfil escolhido respondem 401 com code "profile"
    OWNED = ("/api/decks", "/api/sim/runs", "/api/sim/record", "/api/tournaments", "/api/ratings", "/api/arena", "/api/play/start", "/api/play/from-state", "/api/playnet", "/api/limited")

    def no_profile(self):
        if self.path.startswith(self.OWNED) and self.mode() == "profiles" and not self.profile():
            self.json({"erro": "Escolhe um perfil primeiro.", "code": "profile"}, 401)
            return True
        return False

    def profiles_route(self, method):
        """GET /api/profiles -> {mode, current, list}; POST {name, color} cria e escolhe; POST /<id>/select;
        PUT /<id> {name, color}; DELETE /<id> (os decks vão para o lixo)."""
        cookie = lambda pid, age=31536000: {"Set-Cookie": f"grimorio_profile={pid}; Path=/; Max-Age={age}; SameSite=Lax; HttpOnly"}  # noqa: E731
        mode, path = self.mode(), self.path.split("?")[0]
        if method == "GET" and path == "/api/profiles":
            if mode != "profiles":
                return self.json({"mode": mode, "current": {"id": None, "name": self.owner(), "color": None}, "list": []})
            with db() as con:
                rows = con.execute("SELECT id, name, color FROM profiles ORDER BY created").fetchall()
            return self.json({"mode": mode, "current": self.profile(), "list": [{"id": i, "name": n, "color": c} for i, n, c in rows]})
        if mode != "profiles":
            return self.json({"erro": "Os perfis só existem sem login nem dono fixo."}, 400)
        m = re.match(r"^/api/profiles(?:/([a-z0-9]{1,32})(/select)?)?$", path)
        if not m or (method, bool(m.group(1)), bool(m.group(2))) not in {("POST", False, False), ("POST", True, True), ("PUT", True, False), ("DELETE", True, False)}:
            return self.json({"erro": "rota desconhecida"}, 404)
        pid = m.group(1)
        try:
            d = self.body() if method in ("POST", "PUT") and not m.group(2) else {}
            name = str(d.get("name") or "").strip()
            color = d.get("color") if re.match(r"^#[0-9a-fA-F]{6}$", str(d.get("color") or "")) else "#7c5cff"
            if method in ("POST", "PUT") and not m.group(2) and not 1 <= len(name) <= 40:
                raise ValueError("O nome tem de ter 1 a 40 caracteres.")
        except (ValueError, TypeError, AttributeError) as e:
            return self.json({"erro": str(e) if isinstance(e, ValueError) else "pedido inválido"}, 400)
        with db() as con:
            if method == "POST" and not pid:
                # o primeiro perfil fica com os dados de antes ("local", o dono por omissão das versões anteriores)
                pid = "local" if not con.execute("SELECT 1 FROM profiles").fetchone() else uuid.uuid4().hex[:12]
                con.execute("INSERT INTO profiles VALUES (?,?,?,?)", (pid, name, color, time.time()))
                return self.send(201, json.dumps({"id": pid, "name": name, "color": color}, ensure_ascii=False).encode(), headers=cookie(pid))
            if not con.execute("SELECT 1 FROM profiles WHERE id=?", (pid,)).fetchone():
                return self.json({"erro": "Esse perfil não existe."}, 404)
            if method == "POST":
                return self.send(200, b'{"ok": true}', headers=cookie(pid))
            if method == "PUT":
                con.execute("UPDATE profiles SET name=?, color=? WHERE id=?", (name, color, pid))
                return self.json({"id": pid, "name": name, "color": color})
            con.execute("UPDATE decks SET deleted=? WHERE owner=? AND deleted IS NULL", (time.time(), pid))
            con.execute("DELETE FROM profiles WHERE id=?", (pid,))
        cur = self.profile()
        return self.send(200, b'{"ok": true}', headers=None if cur else cookie("", 0))

    def _delete(self):
        if self.path.startswith("/api/profiles"):
            return self.profiles_route("DELETE")
        if self.no_profile():
            return
        if self.path.startswith("/api/tournaments/"):
            return self.json(*reversed(tournament.route("DELETE", self.path, self.owner())))
        mr = re.match(r"^/api/sim/runs/([a-f0-9-]{8,40})$", self.path)
        if mr:
            with db() as con:
                con.execute("DELETE FROM sim_runs WHERE id=? AND owner=?", (mr.group(1), self.owner()))
            return self.json({"ok": True})
        did = self.path.rsplit("/", 1)[1]
        if not self.path.startswith("/api/decks/") or not DECK_ID.match(did):
            return self.json({"erro": "rota desconhecida"}, 404)
        with db() as con:  # vai para o lixo (recuperável 30 dias)
            con.execute("UPDATE decks SET deleted=? WHERE id=? AND owner=?", (time.time(), did, self.owner()))
        return self.json({"ok": True})


def selfcheck():
    """Perfis: `python3 -c "import server; server.selfcheck()"` (servidor numa pasta temporária, porta livre)."""
    import tempfile, threading
    global ARGS
    tmp = tempfile.mkdtemp(prefix="grim-prof-")
    ARGS = argparse.Namespace(data_dir=tmp, owner=None, port=0)
    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"

    def call(method, path, body=None, cookie="", user="", host=""):
        h = {"Content-Type": "application/json", **({"Cookie": cookie} if cookie else {}), **({"Remote-User": user} if user else {}), **({"Host": host} if host else {})}
        req = urllib.request.Request(base + path, json.dumps(body).encode() if body is not None else None, h, method=method)
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read() or b"null"), r.headers.get("Set-Cookie") or ""
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"null"), ""
    ck = lambda sc: sc.split(";")[0]  # noqa: E731
    try:
        st, j, _ = call("GET", "/api/profiles")
        assert st == 200 and j == {"mode": "profiles", "current": None, "list": []}, j
        assert call("GET", "/api/decks")[:2] == (401, {"erro": "Escolhe um perfil primeiro.", "code": "profile"})
        assert call("POST", "/api/profiles", {"name": " "})[0] == 400 and call("POST", "/api/profiles", {"name": "x" * 41})[0] == 400
        st, a, sa = call("POST", "/api/profiles", {"name": "Ana", "color": "#ff0000"})
        assert st == 201 and a["id"] == "local" and "HttpOnly" in sa, (a, sa)  # o primeiro fica com os dados antigos
        st, b, sb = call("POST", "/api/profiles", {"name": "Rui", "color": "nada"})
        assert st == 201 and b["color"] == "#7c5cff" and b["id"] != "local"
        A, B = ck(sa), ck(sb)
        assert call("POST", "/api/decks", {"name": "Deck da Ana", "main": {"Forest": 1}}, A)[0] == 201
        assert [d["name"] for d in call("GET", "/api/decks", cookie=A)[1]] == ["Deck da Ana"]
        assert call("GET", "/api/decks", cookie=B)[1] == []  # decks separados por perfil
        assert call("GET", "/api/me", cookie=B)[1] == {"user": "Rui"} and call("GET", "/api/me")[1] == {"user": None}
        st, _, s2 = call("POST", f"/api/profiles/{a['id']}/select", cookie=B)
        assert st == 200 and ck(s2) == A  # trocar de perfil
        assert call("PUT", f"/api/profiles/{b['id']}", {"name": "Rui M.", "color": "#00ff00"}, B)[1]["name"] == "Rui M."
        j = call("GET", "/api/profiles", cookie=B)[1]
        assert j["current"]["name"] == "Rui M." and [p["name"] for p in j["list"]] == ["Ana", "Rui M."]
        st, _, s3 = call("DELETE", "/api/profiles/local", cookie=A)
        assert st == 200 and "Max-Age=0" in s3  # apagou o próprio perfil: o cookie sai
        with db() as con:
            assert con.execute("SELECT deleted IS NOT NULL FROM decks WHERE owner='local'").fetchone() == (1,)  # deck no lixo
        assert call("GET", "/api/decks", cookie=A)[0] == 401 and call("DELETE", "/api/profiles/nada")[0] == 404
        ARGS.owner = "hubert"  # dono fixo: sem perfis, tudo como antes
        assert call("GET", "/api/profiles")[1] == {"mode": "fixed", "current": {"id": None, "name": "hubert", "color": None}, "list": []}
        assert call("GET", "/api/decks")[0] == 200 and call("POST", "/api/profiles", {"name": "X"})[0] == 400
        assert call("GET", "/api/me", user="eva")[1] == {"user": "eva"} and call("GET", "/api/profiles", user="eva")[1]["mode"] == "login"
        print("selfcheck perfis ok")
        # amigos e convidados (guests.py): o convidado só vê o que é dele e nunca chega às rotas do dono
        tournament.DATA, tournament.DB = tmp, os.path.join(tmp, "grimorio.db")
        assert call("POST", "/api/decks", {"name": "Deck do Hubert", "main": {"Island": 1}})[0] == 201
        assert call("POST", "/api/friends", {"name": "Rui"})[0] == 201
        fr = call("GET", "/api/friends")[1]["friends"][0]
        G = f"grimorio_guest={fr['token']}"
        assert call("GET", "/api/guest/me", cookie=G)[1]["guest"]["name"] == "Rui"
        assert call("GET", "/api/decks", cookie=G)[1] == []  # não vê os decks do anfitrião
        st, dk, _ = call("POST", "/api/decks", {"name": "Deck do Rui", "main": {"Swamp": 1}, "community": True}, G)
        assert st == 201 and dk["friend"] == fr["id"] and "community" not in dk
        assert [d["name"] for d in call("GET", "/api/decks", cookie=G)[1]] == ["Deck do Rui"]
        own = [d for d in call("GET", "/api/decks")[1] if d["name"] == "Deck do Hubert"][0]
        assert call("GET", f"/api/decks/{own['id']}", cookie=G)[0] == 404 and call("PUT", f"/api/decks/{own['id']}", {"name": "x"}, G)[0] == 403
        assert call("DELETE", f"/api/decks/{own['id']}", cookie=G)[0] == 403
        assert call("GET", "/api/friends", cookie=G)[0] == 403 and call("POST", "/api/arena", {}, G)[0] == 403  # rotas do dono: não
        assert call("GET", "/api/backup/export", cookie=G)[0] == 403 and call("GET", "/api/tournaments", cookie=G)[1] == []
        assert any(d.get("friendName") == "Rui" for d in call("GET", "/api/decks")[1])  # o anfitrião vê o deck do amigo
        os.environ["GRIMORIO_GUEST_HOSTS"] = "amigos.exemplo.pt"  # endereço público de convidados: sem convite, nada de APIs
        assert call("GET", "/api/decks", host="amigos.exemplo.pt")[0] == 403 and call("GET", "/api/decks", cookie=G, host="amigos.exemplo.pt")[0] == 200
        del os.environ["GRIMORIO_GUEST_HOSTS"]
        # sala: o anfitrião abre com 3 decks seus, o amigo entra com o dele, o anfitrião começa
        hs = [call("POST", "/api/decks", {"name": f"H{i}", "format": "modern", "main": {"Island": 60}})[1]["id"] for i in range(3)]
        st, room, _ = call("POST", "/api/rooms", {"name": "Sala QA", "type": "elim", "format": "modern", "casual": True, "players": [{"src": "meus", "ref": h} for h in hs]})
        assert st == 201
        assert call("POST", "/api/rooms", {"type": "elim", "format": "modern"}, G)[0] == 403  # convidado não abre salas
        assert call("POST", "/api/rooms", {"type": "mesas", "format": "commander"})[0] == 400  # sem Commander online
        assert call("POST", f"/api/rooms/{room['id']}/join", {"deck": hs[0]}, G)[0] == 400  # deck do anfitrião: não
        st, rv, _ = call("POST", f"/api/rooms/{room['id']}/join", {"deck": dk["id"]}, G)
        assert st == 200 and len(rv["players"]) == 4 and rv["players"][3]["mine"], rv
        assert call("POST", f"/api/rooms/{room['id']}/join", {"deck": dk["id"]}, G)[0] == 409  # um deck por amigo
        assert call("POST", f"/api/rooms/{room['id']}/start", None, G)[0] == 403  # só o anfitrião começa
        st, sr, _ = call("POST", f"/api/rooms/{room['id']}/start")
        assert st == 200 and sr["tid"], sr
        assert [t["id"] for t in call("GET", "/api/tournaments", cookie=G)[1]] == [sr["tid"]]  # o amigo vê o torneio da sala
        # sala de jogo avulso com link: quem não está nos amigos pede o nome e entra como convidado
        st, jr, _ = call("POST", "/api/rooms", {"name": "Jogo QA", "type": "jogo", "format": "modern", "casual": True, "players": [{"src": "meus", "ref": hs[0]}]})
        assert st == 201, jr
        rv = next(r for r in call("GET", "/api/rooms")[1] if r["id"] == jr["id"])
        assert rv["type"] == "jogo" and rv["min"] == 2 and rv["link"].startswith("/sala/"), rv

        class NoRedir(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *a, **k):
                return None
        op = urllib.request.build_opener(NoRedir)
        with op.open(base + rv["link"]) as r:
            assert b"name=nome" in r.read()
        try:
            op.open(base + rv["link"] + "?nome=Bia")
            raise AssertionError("o link da sala devia redirecionar")
        except urllib.error.HTTPError as e:
            assert e.code == 302 and "grimorio_guest=" in (e.headers.get("Set-Cookie") or ""), e.code
        assert any(f["name"] == "Bia (sala)" for f in call("GET", "/api/friends")[1]["friends"])
        try:
            op.open(base + "/sala/naoexiste")
        except urllib.error.HTTPError as e:
            assert e.code == 404
        assert call("POST", f"/api/friends/{fr['id']}/revoke")[0] == 200 and call("GET", "/api/guest/me", cookie=G)[1]["expired"] is True  # revogado
        print("selfcheck convidados ok")
    finally:
        srv.shutdown()
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)


def rated_list(d):
    return {"main": d.get("main") or {}, "commanders": d.get("commanders") or []}


def with_rated(con, did, d):
    """`rated` = a lista com que o deck ganhou os ratings (só enquanto os tiver): a guardada ou, ainda sem nenhuma, a de
    agora. Depois de um recomeço o deck fica sem `rated` até voltar a ter jogos."""
    if not ratings.rated(con, f"deck:{did}"):
        d.pop("rated", None)
    elif not (d.get("rated") or {}).get("list"):
        d["rated"] = {"list": rated_list(d)}
    return d


def backfill_created(con):
    """Decks de antes da data de criação: a mais antiga em que o deck aparece (gravação, testes, ratings, torneios)."""
    rows = con.execute("SELECT id, body, updated FROM decks WHERE json_extract(body, '$.created') IS NULL").fetchall()
    for did, body, upd in rows:
        ts = [upd]
        for q, a in (("SELECT min(ts) FROM sim_games WHERE deck_id=?", (did,)), ("SELECT min(ts) FROM sim_runs WHERE deck_id=?", (did,)),
                     ("SELECT min(ts) FROM rating_games WHERE a_key=? OR b_key=?", (f"deck:{did}",) * 2),
                     ("SELECT min(ts) FROM tournaments WHERE instr(state, ?) > 0", (did,))):
            try:
                ts.append(con.execute(q, a).fetchone()[0])
            except sqlite3.Error:  # tabela ainda não existe (instalação nova)
                pass
        d = json.loads(body)
        d["created"] = min(x for x in ts if x)
        con.execute("UPDATE decks SET body=? WHERE id=?", (json.dumps(d, ensure_ascii=False), did))
    return len(rows)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8107)
    ap.add_argument("--data-dir", default=os.path.expanduser("~/.local/share/grimorio"))
    ap.add_argument("--owner", default=os.environ.get("GRIMORIO_OWNER") or None,
                    help="dono fixo dos decks quando não há login; sem ele, cada um escolhe um perfil no browser")
    ARGS = ap.parse_args()
    os.makedirs(ARGS.data_dir, exist_ok=True)
    play.init(ARGS.data_dir)
    with db() as con:
        backfill_created(con)
    tournament.init(ARGS.data_dir, busy=lambda: bool(play.S))  # retoma os torneios a decorrer
    ratings.init(ARGS.data_dir, busy=lambda: bool(play.S))  # retoma a Arena automática se estava ligada
    backup.init(ARGS.data_dir)  # pasta na nuvem (se ligada): traz o que mudou noutros aparelhos e leva o daqui
    print(f"Grimório em http://{ARGS.host}:{ARGS.port}", flush=True)
    ThreadingHTTPServer((ARGS.host, ARGS.port), H).serve_forever()
