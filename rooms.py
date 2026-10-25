"""Salas de torneio com amigos: o anfitrião prepara o torneio (regras + os seus decks) e abre uma sala; os amigos
convidados (guests.py) entram com um deck seu; o anfitrião começa e nasce um torneio normal (tournament.create),
visível aos amigos (`friends_open`) para o verem ao vivo e apostarem.
"""
import json, re, secrets, time

import tournament

ROOM = re.compile(r"^/api/rooms(?:/([a-f0-9]{10})(?:/(join|leave|start|cancel))?)?$")


def init(con):
    con.execute("CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, owner TEXT, ts REAL, spec TEXT, players TEXT,"
                " status TEXT, tid TEXT)")


def view(con, r, who):
    rid, ts, spec, players, status, tid = r
    spec, players = json.loads(spec), json.loads(players)
    lo, hi = tournament.TYPES.get(spec.get("type"), (2, 32))
    return {"id": rid, "ts": ts, "status": status, "tid": tid, "name": spec.get("name"), "type": spec.get("type"),
            "format": spec.get("format"), "casual": bool(spec.get("casual")), "bo": spec.get("bo"), "min": lo, "max": hi,
            "players": [{"name": p.get("name"), "by": p.get("byName"), "mine": p.get("by") == who, "ref": p.get("ref")} for p in players]}


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
        return 200, [view(con, r, who) for r in rows(con, owner, open_only=bool(guest))]
    if method != "POST":
        return 404, {"erro": "rota desconhecida"}
    if not rid:  # criar (só o dono)
        if guest:
            return 403, {"erro": "Só quem aloja pode abrir salas."}
        d = body or {}
        spec = {k: d.get(k) for k in ("name", "type", "format", "casual", "bo", "third", "rounds", "seeding", "team", "cross", "hold")}
        if spec["type"] not in tournament.TYPES:
            return 400, {"erro": "Tipo de torneio desconhecido."}
        players = [{**{k: p.get(k) for k in ("src", "ref", "difficulty", "cover", "colors", "me", "name")}, "by": "host"} for p in (d.get("players") or []) if isinstance(p, dict)]
        rid = secrets.token_hex(5)
        con.execute("INSERT INTO rooms VALUES (?,?,?,?,?, 'open', NULL)", (rid, owner, time.time(), json.dumps(spec), json.dumps(players)))
        return 201, {"id": rid}
    r = con.execute("SELECT id, ts, spec, players, status, tid FROM rooms WHERE id=? AND owner=?", (rid, owner)).fetchone()
    if not r:
        return 404, {"erro": "Essa sala não existe."}
    spec, players, status = json.loads(r[2]), json.loads(r[3]), r[4]
    if status != "open":
        return 409, {"erro": "Esta sala já não está aberta."}
    lo, hi = tournament.TYPES[spec["type"]]
    if act == "join":
        did = (body or {}).get("deck")
        name = deck_ok(con, owner, did, guest["id"] if guest else None)
        if not name:
            return 400, {"erro": "Esse deck não é teu ou não existe."}
        if guest and any(p.get("by") == who for p in players):
            return 409, {"erro": "Já tens um deck nesta sala (sai primeiro para trocar)."}
        if len(players) >= hi:
            return 409, {"erro": "A sala está cheia."}
        players.append({"src": "meus", "ref": did, "name": name, "by": who, "byName": guest["name"] if guest else None, "difficulty": "default"})
    elif act == "leave":
        ref = (body or {}).get("ref")
        players = [p for p in players if not (p.get("by") == who and (not ref or p.get("ref") == ref))] if guest else [p for p in players if p.get("ref") != ref]
    elif act == "cancel" and not guest:
        con.execute("UPDATE rooms SET status='cancelled' WHERE id=?", (rid,))
        return 200, {"ok": True}
    elif act == "start" and not guest:
        if not lo <= len(players) <= hi:
            return 400, {"erro": f"Este tipo de torneio leva entre {lo} e {hi} decks (há {len(players)})."}
        try:
            tid = tournament.create(owner, {**spec, "friends_open": True, "players": [{k: p.get(k) for k in ("src", "ref", "difficulty", "cover", "colors", "me")} for p in players]})
        except ValueError as e:
            return 400, {"erro": str(e)}
        con.execute("UPDATE rooms SET status='started', tid=? WHERE id=?", (tid, rid))
        return 200, {"tid": tid}
    else:
        return 403, {"erro": "Não podes fazer isto nesta sala."}
    con.execute("UPDATE rooms SET players=? WHERE id=?", (json.dumps(players), rid))
    return 200, view(con, con.execute("SELECT id, ts, spec, players, status, tid FROM rooms WHERE id=?", (rid,)).fetchone(), who)
