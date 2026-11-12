"""Salas de torneio, de jogos avulsos (tipo «jogo»: 2–4 decks, uma partida ou uma mesa) e de mesa livre (tipo «livre»:
2–4 amigos jogam eles mesmos, sem bots nem regras — freetable.py) com amigos: o anfitrião prepara o torneio (regras + os seus decks) e abre uma sala; os amigos
convidados (guests.py) entram com um deck seu; o anfitrião começa e nasce um torneio normal (tournament.create),
visível aos amigos (`friends_open`) para o verem ao vivo e apostarem.
"""
import json, re, secrets, sqlite3, threading, time

import avatars
import freetable
import playnet
import sim
import tournament

ROOM = re.compile(r"^/api/rooms(?:/([a-f0-9]{10})(?:/(join|leave|start|cancel|ready|lend|plays|chat|show|live))?)?$")
# o lobby 3D ao vivo (só em memória, nunca na base de dados): posição de cada caixa/carta, virada, na mão de quem, o deck
# aberto. Quem mexe manda; os outros lêem várias vezes por segundo. Some quando a sala começa ou é cancelada.
LIVE = {}
GO = 4  # segundos de contagem quando estão todos prontos (mesa livre)
# a mesa que está a abrir: os pedidos chegam em paralelo (a lista de quem aloja e a de cada convidado, de segundo a segundo
# na contagem) e cada um via a sala ainda «open» — abriam-se várias mesas (na estrita, um Forge de ~1 GB por cada).
# O primeiro reclama a sala; os outros saltam-na durante CLAIM_S (até lá o primeiro já gravou «started»).
CLAIM, CLAIM_LOCK, CLAIM_S = {}, threading.Lock(), 60


class Busy(Exception):
    """Esta sala já está a abrir noutro pedido."""


def claim(rid):
    with CLAIM_LOCK:
        if time.time() - CLAIM.get(rid, 0) < CLAIM_S:
            return False
        CLAIM[rid] = time.time()
        return True


def init(con):
    con.execute("CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, owner TEXT, ts REAL, spec TEXT, players TEXT,"
                " status TEXT, tid TEXT)")


def span(spec):
    """(mínimo, máximo) de decks: a mesa livre leva 2 até ao máximo escolhido (4 no máximo)."""
    if spec.get("type") == "livre":
        if spec.get("giant"):  # Two-Headed Giant: exatamente 4 (duas equipas de dois)
            return 4, 4
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


def live(con, owner, rid, who, method, body):
    r = con.execute("SELECT status FROM rooms WHERE id=? AND owner=?", (rid, owner)).fetchone()
    if not r or r[0] != "open":
        LIVE.pop(rid, None)
        return 404, {"erro": "Essa sala não está aberta."}
    return 200, live_step(LIVE.setdefault(rid, {"seq": 0, "objs": {}, "open": None}), who, method, body)


def live_step(L, who, method, body):
    """O canal ao vivo de uma mesa 3D (lobby da sala, mesa da Taverna): POST mexe (caixas, cartas, cursor, deck aberto), GET lê."""
    if method == "POST":
        b = body or {}
        num = lambda v, lo=-20.0, hi=20.0: max(lo, min(hi, float(v))) if isinstance(v, (int, float)) else 0.0
        for o in (b.get("objs") or [])[:160]:
            if not isinstance(o, dict) or not o.get("id"):
                continue
            i = str(o["id"])[:80]
            cur = L["objs"].get(i, {})
            cur.update(x=num(o.get("x")), z=num(o.get("z")), r=num(o.get("r"), -1e3, 1e3), f=bool(o.get("f")), by=who, t=round(time.time(), 2))
            if "hand" in o:
                cur["hand"] = who if o.get("hand") else None
            L["objs"][i] = cur
        if len(L["objs"]) > 400:  # a mesa da Taverna vive muito tempo: as peças mexidas há mais tempo saem
            for k in sorted(L["objs"], key=lambda k: L["objs"][k].get("t", 0))[:len(L["objs"]) - 400]:
                del L["objs"][k]
        if isinstance(b.get("ptr"), dict):  # o meu cursor na mesa (plano x/z) e o nome curto: os outros veem a «mãozinha»
            q = b["ptr"]
            if q.get("off"):
                L.setdefault("ptr", {}).pop(who, None)
            else:
                L.setdefault("ptr", {})[who] = {"x": num(q.get("x")), "z": num(q.get("z")), "n": str(q.get("n") or "")[:24], "t": round(time.time(), 2)}
        if "open" in b:
            o = b.get("open")
            for i in [k for k in L["objs"] if "#" in k]:  # as cartas do deck que estava aberto saem da mesa
                del L["objs"][i]
            L["open"] = {"key": str(o.get("key"))[:80], "list": [[str(n)[:80], max(1, min(4, int(c)))] for n, c in (o.get("list") or [])[:90] if isinstance(c, int)],
                         "by": who, "t": time.time()} if isinstance(o, dict) and o.get("key") else None
        L["seq"] += 1
    now = time.time()
    return {"seq": L["seq"], "objs": L["objs"], "open": L["open"], "me": who,
            "ptr": {k: {**v, "age": round(now - v["t"], 1)} for k, v in (L.get("ptr") or {}).items() if k != who and now - v["t"] < 8}}


def lobby(con, owner, p, who):
    """O que o lobby 3D mostra de um lugar: quantas cartas (a altura da caixa), as cores e a capa; a lista só se o dono
    deixar ver (ou se o deck é meu)."""
    d = (owner and seat_deck(con, owner, p)) or {}
    main = d.get("main") or {}
    out = {"n": sum(int(v) for v in main.values() if str(v).isdigit() or isinstance(v, int)), "cover": d.get("cover") or d.get("coverImg") or None}
    if p.get("show") or p.get("by") == who:
        out["list"] = {str(k): int(v) for k, v in list(main.items())[:120]}
    return out


def view(con, r, who, owner=None):
    rid, ts, spec, players, status, tid = r
    spec, players = json.loads(spec), json.loads(players)
    lo, hi = span(spec)
    livre = spec.get("type") == "livre" and status == "open"
    av = avatars.many(con, owner) if owner else {}  # a imagem de perfil de quem está sentado (avatars.py)
    return {"id": rid, "ts": ts, "status": status, "tid": tid, "name": spec.get("name"), "type": spec.get("type"),
            "format": spec.get("format"), "casual": bool(spec.get("casual")), "bo": spec.get("bo"), "min": lo, "max": hi, "free": bool(spec.get("free")),
            "misto": bool(spec.get("misto")), **({"wait": spec.get("wait") or 0} if spec.get("misto") else {}), **({"strict": True} if spec.get("strict") else {}), **({"giant": True} if spec.get("giant") else {}),
            "players": [{"name": p.get("name"), "by": p.get("byName"), "mine": p.get("by") == who, "ref": p.get("ref"), "src": p.get("src"),
                         "host": p.get("by") == "host", "ready": bool(p.get("ready")), "show": bool(p.get("show")), **({"av": av[p["by"]]} if av.get(p.get("by")) else {}),
                         **(lobby(con, owner, p, who) if livre else {}),
                         **({"plays": p.get("plays") or "bot", "difficulty": p.get("difficulty") or "default"} if spec.get("misto") else {})} for p in players],
            **({"go": round(max(0.0, spec["go"] - time.time()), 1), "first": spec.get("first", 0)} if spec.get("go") else {}),
            **({"chat": (spec.get("chat") or [])[-60:]} if livre else {}),
            **({"lend": lent(con, owner, spec)} if (spec.get("type") == "livre" or spec.get("free") or spec.get("misto")) and owner and status == "open" else {}),
            **({"link": f"/sala/{spec['link']}"} if who == "host" and spec.get("link") else {}),
            **({"opener": spec.get("byName"), "own": spec["by"] == who} if spec.get("by") else {})}  # a mesa de um membro da Taverna


def seat_deck(con, owner, p):
    """O deck de um lugar da mesa livre: do anfitrião ou do convidado (decks), emprestado ou do meta (só leitura)."""
    if p.get("src") == "meta":
        return sim.opponent(tournament.DATA, str(p.get("ref")))
    r = con.execute("SELECT body FROM decks WHERE id=? AND owner=? AND deleted IS NULL", (str(p.get("ref")), owner)).fetchone()
    return r and json.loads(r[0])


def host_name(con, owner):
    """O nome de quem aloja na mesa: o do perfil (o .exe/pacote, sem login, tem perfis com id interno) ou o login."""
    try:
        r = con.execute("SELECT name FROM profiles WHERE id=?", (owner,)).fetchone()
    except sqlite3.OperationalError:
        r = None
    return (r and r[0]) or owner


def start_livre(con, owner, rid, spec, players):
    if not claim(rid):
        raise Busy()
    try:
        return _start_livre(con, owner, rid, spec, players)
    except BaseException:
        CLAIM.pop(rid, None)  # não abriu: pode tentar-se outra vez
        raise


def _start_livre(con, owner, rid, spec, players):
    seats, me = [], host_name(con, owner)
    for p in players:
        d = seat_deck(con, owner, p)
        if not d:
            raise ValueError(f"O deck «{p.get('name')}» já não existe.")
        seats.append({"by": p["by"], "name": p.get("byName") or me, "deck": d})
    if spec.get("strict"):  # mesa estrita: um jogo do Forge com as duas pessoas (playnet); o id vai como «fp:<sessão>»
        if not 2 <= len(seats) <= 4:
            raise ValueError("A mesa estrita é para 2 a 4 jogadores.")
        key = lambda by: owner if by == "host" else f"{owner}~{by}"  # noqa: E731  (convidado: «<dono>~guest:<id>», como no Forge Play)
        flat = lambda d: {**d, "main": {**(d.get("main") or {}), **{c: 1 for c in d.get("commanders") or []}}, "commanders": []}  # noqa: E731
        giant = bool(spec.get("giant")) and len(seats) == 4
        first = 0 if giant else int(spec.get("first") or 0) % len(seats)
        order = seats[first:] + seats[:first]  # a 2–3: a ordem a partir de quem ganhou a moeda (o Forge volta a decidir quem começa); 2HG: as equipas pela ordem
        ks = "abcd"[:len(order)]
        av = avatars.many(con, owner)
        sid = playnet.start_pvp(tournament.DATA, {k: key(x["by"]) for k, x in zip(ks, order)}, {k: flat(x["deck"]) for k, x in zip(ks, order)},
                                {k: x["name"] for k, x in zip(ks, order)}, mode="2hg" if giant else "ffa", avs={k: av.get(x["by"]) for k, x in zip(ks, order)})
        tid = "fp:" + sid
        con.execute("UPDATE rooms SET status='started', tid=? WHERE id=?", (tid, rid))
        LIVE.pop(rid, None)
        return tid
    tid = freetable.create(con, owner, spec.get("name"), seats, first=int(spec.get("first") or 0), giant=bool(spec.get("giant")), keep=True)
    con.execute("UPDATE rooms SET status='started', tid=? WHERE id=?", (tid, rid))
    LIVE.pop(rid, None)
    return tid


def due(con, owner):
    """Mesas livres com todos prontos e a contagem acabada: começam (quem estiver a ver a lista arranca-as)."""
    for rid, spec, players in con.execute("SELECT id, spec, players FROM rooms WHERE owner=? AND status='open' AND json_extract(spec, '$.go') IS NOT NULL", (owner,)).fetchall():
        spec = json.loads(spec)
        if spec.get("go") and spec["go"] <= time.time():
            try:
                start_livre(con, owner, rid, spec, json.loads(players))
            except Busy:
                continue
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


def guest_room(con, owner, guest, d):
    """Um membro da Taverna (convidado) abre uma mesa livre ou estrita nas salas de quem aloja, com um deck seu. Fica
    marcada como dele (spec.by): pode começá-la e cancelá-la; torneios e jogos com bots só quem aloja."""
    import taverna
    who = f"guest:{guest['id']}"
    if d.get("type") != "livre":
        return 403, {"erro": "Só quem aloja abre torneios e jogos com os bots."}
    bad = taverna.room_ok(con, owner, who)
    if bad:
        return bad[0], {"erro": bad[1]}
    p0 = (d.get("players") or [None])[0] if isinstance(d.get("players"), list) else None
    dname = isinstance(p0, dict) and deck_ok(con, owner, p0.get("ref"), guest["id"])
    if not dname:
        return 400, {"erro": "Escolhe um deck teu para a mesa."}
    giant = bool(d.get("giant"))
    try:
        mx = 4 if giant else max(2, min(4, int(d.get("max") or 4)))
    except (TypeError, ValueError):
        mx = 4
    name = taverna.clean(d.get("name"), 80) or "Mesa livre"
    spec = {"name": name, "type": "livre", "format": None, "casual": True, "max": mx, "strict": bool(d.get("strict")) or None,
            **({"giant": True} if giant else {}), "by": who, "byName": guest["name"], "link": secrets.token_urlsafe(12)}
    rid = secrets.token_hex(5)
    players = [{"src": "meus", "ref": str(p0["ref"]), "name": dname, "by": who, "byName": guest["name"], "difficulty": "default"}]
    con.execute("INSERT INTO rooms VALUES (?,?,?,?,?, 'open', NULL)", (rid, owner, time.time(), json.dumps(spec), json.dumps(players)))
    return 201, {"id": rid}


def route(con, method, path, owner, body, guest=None):
    """Dono: GET lista, POST cria {spec, players}, POST /<id>/start|cancel. Convidado: GET as abertas, /<id>/join {deck}|leave."""
    init(con)
    m = ROOM.match(path)
    if not m:
        return 404, {"erro": "rota desconhecida"}
    rid, act = m.group(1), m.group(2)
    who = f"guest:{guest['id']}" if guest else "host"
    if act == "live":
        return live(con, owner, rid, who, method, body)
    if method == "GET" and not rid:
        due(con, owner)
        return 200, [view(con, r, who, owner) for r in rows(con, owner, open_only=bool(guest))]
    if method != "POST":
        return 404, {"erro": "rota desconhecida"}
    if not rid:  # criar: o dono; um membro da Taverna só mesas livres ou estritas (guest_room; limites em taverna.room_ok)
        if guest:
            return guest_room(con, owner, guest, body if isinstance(body, dict) else {})
        d = body or {}
        spec = {k: d.get(k) for k in ("name", "type", "format", "casual", "bo", "third", "rounds", "seeding", "team", "cross", "hold", "free", "misto", "wait", "strict", "giant")}
        players = [{**{k: p.get(k) for k in ("src", "ref", "difficulty", "cover", "colors", "me", "name", "plays")}, "by": "host"} for p in (d.get("players") or []) if isinstance(p, dict)]
        for p in players:  # sem nome (pedido pela API): o do deck guardado
            p["name"] = p["name"] or (p["src"] == "meus" and deck_ok(con, owner, p["ref"], None)) or None
        if spec["type"] == "livre":  # mesa livre: um lugar por pessoa (o anfitrião com um deck seu), qualquer formato
            spec.update(format=None, casual=True, max=max(2, min(4, int(d.get("max") or 4))), strict=bool(d.get("strict")) or None)
            if spec.get("giant"):  # Two-Headed Giant: 4 lugares, equipas pela ordem (1.º+2.º contra 3.º+4.º); também na mesa estrita
                spec.update(giant=True, max=4)
            players = players[:1]
            dname = players and deck_ok(con, owner, players[0].get("ref"), None)
            if not dname:
                return 400, {"erro": "Escolhe um deck teu para a mesa."}
            players[0].update(src="meus", name=dname)
        elif spec["type"] not in tournament.TYPES:
            return 400, {"erro": "Tipo de torneio desconhecido."}
        elif spec.get("free"):  # torneio de mesa livre: sem bots, qualquer formato (Commander incluído), vários decks por pessoa
            spec.update(free=True, casual=True, misto=None)
        elif spec.get("misto"):  # misto: bots do Forge e pessoas no mesmo torneio, vários decks por pessoa; Commander só
            spec["misto"] = True  # se jogarem todos eles mesmos (vira torneio de mesa livre; tournament.create confirma)
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
        free = livre or spec.get("free") or spec.get("misto")
        if free and src == "meta":  # um deck do meta, emprestado só para a mesa (lê-se dos ficheiros do meta)
            name = (sim.opponent(tournament.DATA, str(did)) or {}).get("name")
        elif free and src == "lend":  # um deck que quem aloja empresta nesta mesa
            name = did in (spec.get("lend") or []) and deck_ok(con, owner, did, None)
        else:
            src, name = "meus", deck_ok(con, owner, did, guest["id"] if guest else None)
        if not name:
            return 400, {"erro": "Esse deck não é teu ou não existe."}
        many = spec.get("free") or spec.get("misto")
        if (guest or livre) and not many and any(p.get("by") == who for p in players):
            return 409, {"erro": "Já tens um deck nesta sala (sai primeiro para trocar)."}
        if many and guest and sum(1 for p in players if p.get("by") == who) >= 6:
            return 409, {"erro": "Já tens 6 decks neste torneio."}
        if len(players) >= hi:
            return 409, {"erro": "A sala está cheia."}
        players.append({"src": src, "ref": did, "name": name, "by": who, "byName": guest["name"] if guest else None, "difficulty": "default",
                        **({"plays": "dono" if (body or {}).get("plays", "dono") == "dono" else "bot"} if spec.get("misto") else {})})
    elif act == "plays" and spec.get("misto"):  # misto: este deck joga-o o dono ou o bot (e com que dificuldade)
        p = next((p for p in players if p.get("ref") == (body or {}).get("ref") and (p.get("by") == who or not guest)), None)
        if not p:
            return 403, {"erro": "Esse deck não é teu."}
        if (body or {}).get("plays") in ("dono", "bot"):
            p["plays"] = body["plays"]
        if (body or {}).get("difficulty") in {x[0] for x in sim.DIFFICULTIES}:
            p["difficulty"] = body["difficulty"]
    elif act == "leave":
        ref = (body or {}).get("ref")
        players = [p for p in players if not (p.get("by") == who and (not ref or p.get("ref") == ref))] if guest else [p for p in players if p.get("ref") != ref]
    elif act == "ready" and livre:  # pronto (ou já não): quando todos os sentados estão prontos, a mesa começa sozinha
        p = next((p for p in players if p.get("by") == who), None)
        if not p:
            return 409, {"erro": "Senta-te primeiro com um deck."}
        on = (body or {}).get("on")
        p["ready"] = (not p.get("ready")) if on is None else bool(on)
    elif act == "lend" and (livre or spec.get("free") or spec.get("misto")) and not guest:  # emprestar (ou deixar de emprestar) um deck meu a quem se sentar
        did = (body or {}).get("deck")
        if not deck_ok(con, owner, did, None):
            return 400, {"erro": "Esse deck não é teu ou não existe."}
        lend = [x for x in spec.get("lend") or [] if x != did]
        spec["lend"] = lend + ([did] if (body or {}).get("on", True) else [])
        players = [p for p in players if not (p.get("src") == "lend" and p.get("ref") not in spec["lend"])]
    elif act == "chat" and livre:  # a conversa do lobby (quem está na sala)
        m = str((body or {}).get("m") or "").strip()[:240]
        if not m:
            return 400, {"erro": "Mensagem vazia."}
        nm = guest["name"] if guest else next((p.get("byName") for p in players if p.get("by") == "host"), None) or "Anfitrião"
        spec["chat"] = (spec.get("chat") or [])[-59:] + [{"w": nm, "by": who, "t": round(time.time()), "m": m}]
    elif act == "show" and livre:  # deixar (ou não) os outros ver e mexer no meu deck no lobby
        on = (body or {}).get("on")
        mine = [p for p in players if p.get("by") == who]
        if not mine:
            return 409, {"erro": "Senta-te primeiro com um deck."}
        for p in mine:
            p["show"] = (not p.get("show")) if on is None else bool(on)
    elif act == "cancel" and (not guest or spec.get("by") == who):  # quem aloja, ou o membro que abriu esta mesa
        con.execute("UPDATE rooms SET status='cancelled' WHERE id=?", (rid,))
        LIVE.pop(rid, None)
        return 200, {"ok": True}
    elif act == "start" and (not guest or (livre and spec.get("by") == who)):
        if not lo <= len(players) <= hi:
            return 400, {"erro": f"Este tipo de torneio leva entre {lo} e {hi} decks (há {len(players)})."}
        if livre:  # quem aloja pode começar sem esperar que estejam todos prontos
            try:
                return 200, {"table": start_livre(con, owner, rid, spec, players)}
            except Busy:
                return 409, {"erro": "A mesa já está a abrir."}
            except ValueError as e:
                return 400, {"erro": str(e)}
        try:
            tid = tournament.create(owner, {**spec, "friends_open": True, "players": [{**{k: p.get(k) for k in ("src", "ref", "difficulty", "cover", "colors", "me", "by", "byName")},
                                                                                       **({"plays": p.get("plays")} if spec.get("misto") else {}),
                                                                                       **({"src": "meus"} if p.get("src") == "lend" else {})} for p in players]})
        except ValueError as e:
            return 400, {"erro": str(e)}
        con.execute("UPDATE rooms SET status='started', tid=? WHERE id=?", (tid, rid))
        return 200, {"tid": tid}
    else:
        return 403, {"erro": "Não podes fazer isto nesta sala."}
    if livre:  # a contagem: todos os sentados prontos e gente que chegue; qualquer mudança volta a pô-la a zero
        was = spec.get("go")
        spec["go"] = (was or time.time() + GO) if len(players) >= lo and all(p.get("ready") for p in players) else None
        if spec["go"] and not was:  # a moeda ao ar: quem começa (todos a veem no lobby durante a contagem)
            spec["first"] = secrets.randbelow(len(players))
    con.execute("UPDATE rooms SET players=?, spec=? WHERE id=?", (json.dumps(players), json.dumps(spec), rid))
    return 200, view(con, con.execute("SELECT id, ts, spec, players, status, tid FROM rooms WHERE id=?", (rid,)).fetchone(), who, owner)
