"""Salas de torneio, de jogos avulsos (tipo «jogo»: 2–4 decks, uma partida ou uma mesa) e de mesa livre (tipo «livre»:
2–4 amigos jogam eles mesmos, sem bots nem regras — freetable.py) com amigos: o anfitrião prepara o torneio (regras + os seus decks) e abre uma sala; os amigos
convidados (guests.py) entram com um deck seu; o anfitrião começa e nasce um torneio normal (tournament.create),
visível aos amigos (`friends_open`) para o verem ao vivo e apostarem.
"""
import json, re, secrets, time

import freetable
import sim
import tournament

ROOM = re.compile(r"^/api/rooms(?:/([a-f0-9]{10})(?:/(join|leave|start|cancel|ready|lend))?)?$")
GO = 4  # segundos de contagem quando estão todos prontos (mesa livre)


def init(con):
    con.execute("CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, owner TEXT, ts REAL, spec TEXT, players TEXT,"
                " status TEXT, tid TEXT)")


def span(spec):
    """(mínimo, máximo) de decks: a mesa livre leva 2 até ao máximo escolhido (4 no máximo)."""
    if spec.get("type") == "livre":
        return 2, max(2, min(4, int(spec.get("max") or 4)))
    return tournament.TYPES.get(spec.get("type"), (2, 32))


def lent(con, owner, spec):
    """Os decks que quem aloja empresta nesta mesa livre (inteiros: emprestar é mostrar a lista a quem se senta)."""
    out = []
    for did in spec.get("lend") or []:
        r = con.execute("SELECT body FROM decks WHERE id=? AND owner=? AND deleted IS NULL", (did, owner)).fetchone()
        if r:
            b = json.loads(r[0])
            out.append({"id": did, **{k: b.get(k) for k in ("name", "format", "main", "commanders", "cover", "coverImg")}})
    return out


def view(con, r, who, owner=None):
    rid, ts, spec, players, status, tid = r
    spec, players = json.loads(spec), json.loads(players)
    lo, hi = span(spec)
    return {"id": rid, "ts": ts, "status": status, "tid": tid, "name": spec.get("name"), "type": spec.get("type"),
            "format": spec.get("format"), "casual": bool(spec.get("casual")), "bo": spec.get("bo"), "min": lo, "max": hi, "free": bool(spec.get("free")),
            "players": [{"name": p.get("name"), "by": p.get("byName"), "mine": p.get("by") == who, "ref": p.get("ref"), "src": p.get("src"),
                         "host": p.get("by") == "host", "ready": bool(p.get("ready"))} for p in players],
            **({"go": round(max(0.0, spec["go"] - time.time()), 1)} if spec.get("go") else {}),
            **({"lend": lent(con, owner, spec)} if spec.get("type") == "livre" and owner and status == "open" else {}),
            **({"link": f"/sala/{spec['link']}"} if who == "host" and spec.get("link") else {})}


def seat_deck(con, owner, p):
    """O deck de um lugar da mesa livre: do anfitrião ou do convidado (decks), emprestado ou do meta (só leitura)."""
    if p.get("src") == "meta":
        return sim.opponent(tournament.DATA, str(p.get("ref")))
    r = con.execute("SELECT body FROM decks WHERE id=? AND owner=? AND deleted IS NULL", (str(p.get("ref")), owner)).fetchone()
    return r and json.loads(r[0])


def start_livre(con, owner, rid, spec, players):
    seats = []
    for p in players:
        d = seat_deck(con, owner, p)
        if not d:
            raise ValueError(f"O deck «{p.get('name')}» já não existe.")
        seats.append({"by": p["by"], "name": p.get("byName") or owner, "deck": d})
    tid = freetable.create(con, owner, spec.get("name"), seats)
    con.execute("UPDATE rooms SET status='started', tid=? WHERE id=?", (tid, rid))
    return tid


def due(con, owner):
    """Mesas livres com todos prontos e a contagem acabada: começam (quem estiver a ver a lista arranca-as)."""
    for rid, spec, players in con.execute("SELECT id, spec, players FROM rooms WHERE owner=? AND status='open' AND json_extract(spec, '$.go') IS NOT NULL", (owner,)).fetchall():
        spec = json.loads(spec)
        if spec.get("go") and spec["go"] <= time.time():
            try:
                start_livre(con, owner, rid, spec, json.loads(players))
            except ValueError:
                spec["go"] = None
                con.execute("UPDATE rooms SET spec=? WHERE id=?", (json.dumps(spec), rid))


def rows(con, owner, open_only=False):
    init(con)
    q = "SELECT id, ts, spec, players, status, tid FROM rooms WHERE owner=?" + (" AND status IN ('open', 'started')" if open_only else "") + " ORDER BY ts DESC LIMIT 30"
    return con.execute(q, (owner,)).fetchall()


def deck_ok(con, owner, did, friend):
    """O deck existe no anfitrião e é de quem o põe (o anfitrião: sem `friend`; um amigo: o seu)."""
    r = con.execute("SELECT name, body FROM decks WHERE id=? AND owner=? AND deleted IS NULL", (str(did), owner)).fetchone()
    if not r:
        return None
    body = json.loads(r[1])
    return r[0] if (body.get("friend") or None) == friend else None


def route(con, method, path, owner, body, guest=None):
    """Dono: GET lista, POST cria {spec, players}, POST /<id>/start|cancel. Convidado: GET as abertas, /<id>/join {deck}|leave."""
    init(con)
    m = ROOM.match(path)
    if not m:
        return 404, {"erro": "rota desconhecida"}
    rid, act = m.group(1), m.group(2)
    who = f"guest:{guest['id']}" if guest else "host"
    if method == "GET" and not rid:
        due(con, owner)
        return 200, [view(con, r, who, owner) for r in rows(con, owner, open_only=bool(guest))]
    if method != "POST":
        return 404, {"erro": "rota desconhecida"}
    if not rid:  # criar (só o dono)
        if guest:
            return 403, {"erro": "Só quem aloja pode abrir salas."}
        d = body or {}
        spec = {k: d.get(k) for k in ("name", "type", "format", "casual", "bo", "third", "rounds", "seeding", "team", "cross", "hold", "free")}
        players = [{**{k: p.get(k) for k in ("src", "ref", "difficulty", "cover", "colors", "me", "name")}, "by": "host"} for p in (d.get("players") or []) if isinstance(p, dict)]
        if spec["type"] == "livre":  # mesa livre: um lugar por pessoa (o anfitrião com um deck seu), qualquer formato
            spec.update(format=None, casual=True, max=max(2, min(4, int(d.get("max") or 4))))
            players = players[:1]
            dname = players and deck_ok(con, owner, players[0].get("ref"), None)
            if not dname:
                return 400, {"erro": "Escolhe um deck teu para a mesa."}
            players[0].update(src="meus", name=dname)
        elif spec["type"] not in tournament.TYPES:
            return 400, {"erro": "Tipo de torneio desconhecido."}
        elif spec.get("free"):  # torneio de mesa livre: sem bots, qualquer formato (Commander incluído), vários decks por pessoa
            spec.update(free=True, casual=True)
        elif spec["format"] in sim.GAME_TYPE:  # sem Commander com os bots online: o EDH com amigos é na mesa livre
            return 400, {"erro": "As salas online não têm formatos Commander."}
        rid = secrets.token_hex(5)
        spec["link"] = secrets.token_urlsafe(12)  # /sala/<link>: entra quem não está nos amigos (guests.room_link)
        con.execute("INSERT INTO rooms VALUES (?,?,?,?,?, 'open', NULL)", (rid, owner, time.time(), json.dumps(spec), json.dumps(players)))
        return 201, {"id": rid}
    r = con.execute("SELECT id, ts, spec, players, status, tid FROM rooms WHERE id=? AND owner=?", (rid, owner)).fetchone()
    if not r:
        return 404, {"erro": "Essa sala não existe."}
    spec, players, status = json.loads(r[2]), json.loads(r[3]), r[4]
    if status != "open":
        return 409, {"erro": "Esta sala já não está aberta."}
    lo, hi = span(spec)
    livre = spec["type"] == "livre"
    if act == "join":
        did, src = (body or {}).get("deck"), (body or {}).get("src") or "meus"
        free = livre or spec.get("free")
        if free and src == "meta":  # um deck do meta, emprestado só para a mesa (lê-se dos ficheiros do meta)
            name = (sim.opponent(tournament.DATA, str(did)) or {}).get("name")
        elif free and src == "lend":  # um deck que quem aloja empresta nesta mesa
            name = did in (spec.get("lend") or []) and deck_ok(con, owner, did, None)
        else:
            src, name = "meus", deck_ok(con, owner, did, guest["id"] if guest else None)
        if not name:
            return 400, {"erro": "Esse deck não é teu ou não existe."}
        if (guest or livre) and not spec.get("free") and any(p.get("by") == who for p in players):
            return 409, {"erro": "Já tens um deck nesta sala (sai primeiro para trocar)."}
        if spec.get("free") and guest and sum(1 for p in players if p.get("by") == who) >= 6:
            return 409, {"erro": "Já tens 6 decks neste torneio."}
        if len(players) >= hi:
            return 409, {"erro": "A sala está cheia."}
        players.append({"src": src, "ref": did, "name": name, "by": who, "byName": guest["name"] if guest else None, "difficulty": "default"})
    elif act == "leave":
        ref = (body or {}).get("ref")
        players = [p for p in players if not (p.get("by") == who and (not ref or p.get("ref") == ref))] if guest else [p for p in players if p.get("ref") != ref]
    elif act == "ready" and livre:  # pronto (ou já não): quando todos os sentados estão prontos, a mesa começa sozinha
        p = next((p for p in players if p.get("by") == who), None)
        if not p:
            return 409, {"erro": "Senta-te primeiro com um deck."}
        on = (body or {}).get("on")
        p["ready"] = (not p.get("ready")) if on is None else bool(on)
    elif act == "lend" and livre and not guest:  # emprestar (ou deixar de emprestar) um deck meu a quem se sentar
        did = (body or {}).get("deck")
        if not deck_ok(con, owner, did, None):
            return 400, {"erro": "Esse deck não é teu ou não existe."}
        lend = [x for x in spec.get("lend") or [] if x != did]
        spec["lend"] = lend + ([did] if (body or {}).get("on", True) else [])
        players = [p for p in players if not (p.get("src") == "lend" and p.get("ref") not in spec["lend"])]
    elif act == "cancel" and not guest:
        con.execute("UPDATE rooms SET status='cancelled' WHERE id=?", (rid,))
        return 200, {"ok": True}
    elif act == "start" and not guest:
        if not lo <= len(players) <= hi:
            return 400, {"erro": f"Este tipo de torneio leva entre {lo} e {hi} decks (há {len(players)})."}
        if livre:  # quem aloja pode começar sem esperar que estejam todos prontos
            try:
                return 200, {"table": start_livre(con, owner, rid, spec, players)}
            except ValueError as e:
                return 400, {"erro": str(e)}
        try:
            tid = tournament.create(owner, {**spec, "friends_open": True, "players": [{**{k: p.get(k) for k in ("src", "ref", "difficulty", "cover", "colors", "me", "by")},
                                                                                       **({"src": "meus"} if p.get("src") == "lend" else {})} for p in players]})
        except ValueError as e:
            return 400, {"erro": str(e)}
        con.execute("UPDATE rooms SET status='started', tid=? WHERE id=?", (tid, rid))
        return 200, {"tid": tid}
    else:
        return 403, {"erro": "Não podes fazer isto nesta sala."}
    if livre:  # a contagem: todos os sentados prontos e gente que chegue; qualquer mudança volta a pô-la a zero
        spec["go"] = time.time() + GO if len(players) >= lo and all(p.get("ready") for p in players) else None
    con.execute("UPDATE rooms SET players=?, spec=? WHERE id=?", (json.dumps(players), json.dumps(spec), rid))
    return 200, view(con, con.execute("SELECT id, ts, spec, players, status, tid FROM rooms WHERE id=?", (rid,)).fetchone(), who, owner)
