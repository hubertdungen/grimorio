"""Mesa livre: jogos só entre amigos, sem bots e sem motor de regras (como o untap.in ou o Tabletop Simulator).

A sala (rooms.py, tipo «livre») junta 2–4 pessoas, cada uma com um deck seu; ao começar nasce aqui uma mesa. O estado
vive em memória (e na SQLite, para um reinício do servidor não a perder) e cada jogador lê-o por espera longa (`since`),
como no playnet.py. As jogadas são comandos pequenos aplicados aqui e espalhados a todos: comprar, baralhar, mudar uma
carta de zona, virar (tap), marcadores, vida, dados… Não há validação de regras (é entre amigos); só se garante que
cada carta está numa zona e só numa.

Privacidade (aqui, não no browser): cada jogador recebe só o que pode ver. Mãos e bibliotecas alheias são números (e
costas de cartas), cartas viradas para baixo só as vê quem as controla, as reveladas veem-se. Os ids das cartas são
aleatórios e mudam quando a carta entra na biblioteca (não dá para seguir uma carta baralhada).
"""
import json, random, re, secrets, threading, time

import sim

T = {}                       # id -> mesa (em memória; a SQLite guarda a cópia)
COND = threading.Condition()
ZONES = ("library", "hand", "graveyard", "exile", "command", "battlefield")
PUBLIC = ("graveyard", "exile", "command")
DICE = {"d6": 6, "d20": 20, "moeda": 2}
PEN = ("#ffd166", "#ff5c8a", "#4cc9f0", "#80ed99", "#ffffff", "#c77dff")  # cores da caneta
REACT = ("👍", "😂", "😮", "🔥", "😭", "🤝")
PEN_LIFE = 8  # segundos que um traço da caneta fica no estado (o browser apaga-o antes, a desvanecer)
PATH = re.compile(r"^/api/freetables/([a-f0-9]{12})$")
RNG = random.SystemRandom()


def init(con):
    con.execute("CREATE TABLE IF NOT EXISTS freetables (id TEXT PRIMARY KEY, owner TEXT, ts REAL, state TEXT)")


def _new_id(t):
    while True:
        i = RNG.randrange(1, 2 ** 31)
        if str(i) not in t["cards"]:
            return i


def _deal(t, i):
    """Começar (ou recomeçar) o jogo do lugar i: as cartas dele voltam à biblioteca (o comandante à zona de comando), as
    fichas desaparecem, baralha-se e compra 7."""
    z = t["zones"][i]
    for zone in ZONES:
        for s2 in t["zones"]:  # cartas dele no campo de outro (controlo trocado) também voltam
            for cid in [x for x in s2[zone] if t["cards"][str(x)]["o"] == i]:
                s2[zone].remove(cid)
                c = t["cards"][str(cid)]
                if c.get("tok"):
                    t["cards"].pop(str(cid))
                    continue
                _clean(c)
                _put(t, c, i, "command" if c.get("cm") else "library")
    for cid in list(z["library"]):
        _rekey(t, t["cards"][str(cid)])
    RNG.shuffle(z["library"])
    for cid in z["library"][:7]:
        c = t["cards"][str(cid)]
        _take(t, c); _put(t, c, i, "hand")
    t["seats"][i]["peek"] = 0


def create(con, owner, name, seats, solo=False):
    """seats = [{by, name, deck: {name, format, main, commanders}}] -> id da mesa (já com 7 cartas na mão de cada um).
    solo: um só lugar, para testar um deck (goldfish), com a vida de um adversário imaginário."""
    init(con)
    if not (1 if solo else 2) <= len(seats) <= (1 if solo else 4):
        raise ValueError("A mesa livre leva entre 2 e 4 jogadores.")
    t = {"id": secrets.token_hex(6), "owner": owner, "name": str(name or "Mesa livre")[:80], "seq": 1, "ts": time.time(),
         "status": "playing", "turn": 1, "active": 0, "seats": [], "cards": {}, "zones": [], "log": [], "roll": None,
         **({"solo": True, "gf": 20} if solo else {})}
    for i, s in enumerate(seats):
        d = s["deck"] or {}
        cmdrs = [str(c) for c in (d.get("commanders") or []) if c][:2]
        cmd = d.get("format") in sim.GAME_TYPE and bool(cmdrs)
        z = {k: [] for k in ZONES}
        main = dict(d.get("main") or {})
        for c in cmdrs:  # o comandante pode vir também no main: fica só na zona de comando
            if main.get(c):
                main[c] -= 1
        names = [n for n, k in main.items() for _ in range(max(0, min(int(k or 0), 250)))][:300]
        t["zones"].append(z)
        for n, zone in [(n, "library") for n in names] + [(c, "command") for c in cmdrs]:
            cid = _new_id(t)
            t["cards"][str(cid)] = {"id": cid, "n": str(n)[:150], "o": i, "s": i, "z": zone, **({"cm": True} if zone == "command" else {})}
            z[zone].append(cid)
        t["seats"].append({"by": s["by"], "name": str(s.get("name") or "?")[:40], "deck": str(d.get("name") or "")[:80],
                           "format": d.get("format"), "life": 40 if cmd else 20, "life0": 40 if cmd else 20, "poison": 0, "out": False, "peek": 0})
        _deal(t, i)
    _log(t, None, "start")
    with COND:
        T[t["id"]] = t
    _save(con, t)
    return t["id"]


def _clean(c):
    """Estado de mesa a zeros (a carta entrou numa zona nova)."""
    for k in ("x", "y", "t", "d", "f", "k", "atk", "r"):
        c.pop(k, None)  # (cm = comandante, fica)


def _save(con, t):
    st = {k: v for k, v in t.items() if k != "pen"}  # os traços da caneta são passageiros: não se gravam
    con.execute("INSERT OR REPLACE INTO freetables VALUES (?,?,?,?)", (t["id"], t["owner"], t["ts"], json.dumps(st, ensure_ascii=False)))


def _load(db, tid):
    with COND:
        if tid in T:
            return T[tid]
    with db() as con:
        init(con)
        r = con.execute("SELECT state FROM freetables WHERE id=?", (tid,)).fetchone()
    if not r:
        return None
    with COND:
        return T.setdefault(tid, json.loads(r[0]))


def _seat(t, who, want=None):
    """O lugar de `who` (o pedido com `want`, se também for dele: quem tem os dois decks de uma partida joga os dois)."""
    mine = [i for i, s in enumerate(t["seats"]) if s["by"] == who]
    return want if want in mine else (mine[0] if mine else None)


def _decide(t, w, me=None):
    """Resultado final (w = lugar que ganhou, None = empate): a mesa acaba (os torneios leem-no com result())."""
    t["result"] = {"w": w}
    t.pop("res", None)
    t["status"] = "ended"
    _log(t, me, "result", p=w)


def result(tid, db=None):
    """Para os torneios: None se a mesa não existe; senão {ended, w (lugar que ganhou, None = empate), turns}."""
    t = T.get(tid) or (db and _load(db, tid))
    if not t:
        return None
    return {"ended": "result" in t, "w": (t.get("result") or {}).get("w"), "turns": t["turn"]}


def _public(c):
    z = c["z"]
    return z in PUBLIC or (z == "battlefield" and not c.get("d")) or (z == "hand" and c.get("r"))


def _sees(t, c, me):
    z = c["z"]
    if z == "library":
        return c["o"] == me and c["id"] in t["zones"][me]["library"][:t["seats"][me]["peek"]]
    if z == "hand":
        return c["o"] == me or bool(c.get("r"))
    if z == "battlefield" and c.get("d"):
        return me in (c["o"], c["s"])
    return True


def _card(t, cid, me):
    c = t["cards"][str(cid)]
    out = {"id": c["id"], "o": c["o"]}
    if _sees(t, c, me):
        out["n"] = c["n"]
    for k in ("x", "y", "t", "d", "f", "k", "atk", "r", "tok"):
        if c.get(k) not in (None, False, {}):
            out[k] = c[k]
    return out


def view(t, me):
    """O que o jogador `me` pode ver (o servidor nunca manda nomes escondidos)."""
    seats = []
    for i, s in enumerate(t["seats"]):
        z = t["zones"][i]
        v = {**{k: s[k] for k in ("name", "deck", "format", "life", "poison", "out")}, "me": i == me, "library": len(z["library"]),
             "hand": [_card(t, c, me) for c in z["hand"]], **{k: [_card(t, c, me) for c in z[k]] for k in ("graveyard", "exile", "command", "battlefield")}}
        if i == me and s["peek"]:
            v["top"] = [_card(t, c, me) for c in z["library"][:s["peek"]]]
        seats.append(v)
    return {"id": t["id"], "name": t["name"], "seq": t["seq"], "status": t["status"], "turn": t["turn"], "active": t["active"],
            "me": me, "host": t["seats"][me]["by"] == "host", "mine": [i for i, s in enumerate(t["seats"]) if s["by"] == t["seats"][me]["by"]],
            "res": t.get("res"), "result": t.get("result"), "solo": bool(t.get("solo")), "gf": t.get("gf"), "seats": seats, "log": t["log"][-120:], "roll": t["roll"],
            "pen": [x for x in t.get("pen", []) if x["ts"] > time.time() - PEN_LIFE]}


def _log(t, seat, k, **kw):
    t["lid"] = t.get("lid", 0) + 1  # id de cada entrada (reações)
    t["log"] = (t["log"] + [{"id": t["lid"], "k": k, "s": seat, "ts": round(time.time()), **kw}])[-300:]


def _take(t, c):
    t["zones"][c["s"]][c["z"]].remove(c["id"])


def _put(t, c, seat, zone, bottom=False):
    lst = t["zones"][seat][zone]
    if zone == "library" and not bottom:
        lst.insert(0, c["id"])
    else:
        lst.append(c["id"])
    c["s"], c["z"] = seat, zone


def _rekey(t, c):
    """Entrou na biblioteca: id novo (quem viu a carta antes não a segue depois de baralhar)."""
    lst = t["zones"][c["s"]][c["z"]]
    t["cards"].pop(str(c["id"]))
    i, c["id"] = lst.index(c["id"]), _new_id(t)
    lst[i] = c["id"]
    t["cards"][str(c["id"])] = c


def _num(v, lo, hi, dflt=0):
    try:
        return max(lo, min(hi, int(v)))
    except (TypeError, ValueError):
        return dflt


def _pos(v):
    try:
        return round(max(0.0, min(1.0, float(v))), 4)
    except (TypeError, ValueError):
        return 0.5


def _draw(t, me, n):
    z = t["zones"][me]
    n = min(n, len(z["library"]))
    for _ in range(n):
        c = t["cards"][str(z["library"][0])]
        _take(t, c)
        _put(t, c, me, "hand")
    t["seats"][me]["peek"] = max(0, t["seats"][me]["peek"] - n)
    return n


def apply(t, me, d):
    """Um comando do jogador `me`. Erros de uso -> ValueError (a mesa fica como estava)."""
    if t["status"] != "playing":
        raise ValueError("Esta mesa já terminou.")
    c0 = str(d.get("c") or "")
    seat = t["seats"][me]
    card = None
    if "id" in d:
        card = t["cards"].get(str(d.get("id")))
        if not card:
            raise ValueError("Essa carta já não está lá.")
        # nas zonas escondidas (mão, biblioteca) só mexe o dono; nas públicas qualquer um (é entre amigos)
        if card["z"] in ("hand", "library") and card["o"] != me:
            raise PermissionError("Essa carta não é tua.")
        if card["z"] == "library" and not _sees(t, card, me):
            raise PermissionError("Não podes ver essa carta.")

    def need():
        if not card:
            raise ValueError("Falta a carta.")
        return card
    if c0 == "draw":
        n = _draw(t, me, _num(d.get("n"), 1, 20, 1))
        _log(t, me, "draw", n=n)
    elif c0 == "shuffle":
        RNG.shuffle(t["zones"][me]["library"])
        seat["peek"] = 0
        _log(t, me, "shuffle")
    elif c0 == "mulligan":
        z = t["zones"][me]
        for cid in list(z["hand"]):
            c = t["cards"][str(cid)]
            _take(t, c); _clean(c); _put(t, c, me, "library"); _rekey(t, c)
        RNG.shuffle(z["library"])
        seat["peek"] = 0
        _log(t, me, "mulligan", n=_draw(t, me, 7))
    elif c0 == "move":
        c = need()
        to = d.get("to")
        if to not in ZONES:
            raise ValueError("Zona desconhecida.")
        was_pub, src = _public(c), c["z"]
        if to == "battlefield":
            dest = _num(d.get("seat"), 0, len(t["seats"]) - 1, c["s"] if src == "battlefield" else me)
            if src == "battlefield" and dest == c["s"]:  # só mudar de sítio (vem para cima das outras)
                _take(t, c); _put(t, c, dest, "battlefield")
                c["x"], c["y"] = _pos(d.get("x")), _pos(d.get("y"))
                return
            _take(t, c)
            if src != "battlefield":
                _clean(c)
                if d.get("down"):
                    c["d"] = True
            _put(t, c, dest, "battlefield")
            c["x"], c["y"] = _pos(d.get("x")), _pos(d.get("y"))
        else:
            if src == to and to != "library":
                return
            _take(t, c)
            if c.get("tok"):  # uma ficha que sai do campo deixa de existir
                t["cards"].pop(str(c["id"]))
                _log(t, me, "move", name=c["n"], fr=src, to=to, tok=True, w=c["o"])
                return
            _clean(c)
            _put(t, c, c["o"], to, bool(d.get("bottom")))
            if to == "library":
                _rekey(t, c)
                ps = t["seats"][c["o"]]
                if ps["peek"] and not d.get("bottom"):  # posta no topo enquanto espreitas: continua à vista
                    ps["peek"] += 1
        if src == "library":  # saiu do topo que estava a ser espreitado
            seat["peek"] = max(0, seat["peek"] - 1)
        _log(t, me, "move", name=c["n"] if was_pub or _public(c) else None, fr=src, to=to, w=c["o"], bottom=bool(d.get("bottom")) or None)
    elif c0 in ("tap", "flip", "face", "attack", "counter"):
        c = need()
        if c["z"] != "battlefield":
            raise ValueError("A carta tem de estar no campo.")
        if c0 == "tap":
            c["t"] = not c.get("t") if d.get("on") is None else bool(d["on"])
            if not c["t"]:
                c.pop("atk", None)
        elif c0 == "flip":
            c["f"] = not c.get("f")
            _log(t, me, "flip", name=None if c.get("d") else c["n"])
        elif c0 == "face":
            if me not in (c["o"], c["s"]):
                raise PermissionError("Só quem controla a carta a pode virar para cima ou para baixo.")
            c["d"] = not c.get("d")
            _log(t, me, "face", name=None if c["d"] else c["n"], down=c["d"])
        elif c0 == "attack":
            tgt = d.get("seat")
            if tgt is None:
                c.pop("atk", None)
            else:
                c["atk"], c["t"] = _num(tgt, 0, len(t["seats"]) - 1), True
                _log(t, me, "attack", name=None if c.get("d") else c["n"], p=c["atk"])
        else:
            k = str(d.get("k") or "+1/+1").strip()[:16]
            ks = dict(c.get("k") or {})
            ks[k] = _num(ks.get(k, 0) + _num(d.get("d"), -99, 99, 1), -999, 999)
            if not ks[k]:
                del ks[k]
            c["k"] = ks
    elif c0 in ("untapall", "newturn"):  # newturn: desvirar tudo e comprar uma (o começo do teu turno; a solo conta o turno)
        for cid in t["zones"][me]["battlefield"]:
            c = t["cards"][str(cid)]
            c.pop("t", None); c.pop("atk", None)
        if c0 == "untapall":
            _log(t, me, "untapall")
        else:
            if t.get("solo"):
                t["turn"] += 1
            _log(t, me, "newturn", n=_draw(t, me, 1), turn=t["turn"])
    elif c0 == "newgame":  # a solo: o mesmo deck do princípio
        if not t.get("solo"):
            raise ValueError("Só se recomeça numa mesa a solo.")
        _deal(t, me)
        seat.update(life=seat.get("life0", 20), poison=0)
        t.update(turn=1, gf=20, roll=None)
        _log(t, me, "newgame")
    elif c0 == "gf":  # a vida do adversário imaginário (a solo)
        if not t.get("solo"):
            raise ValueError("Só a solo.")
        t["gf"] = _num(t.get("gf", 20) + _num(d.get("d"), -999, 999), -999, 9999)
        _log(t, me, "gf", d=_num(d.get("d"), -999, 999), v=t["gf"])
    elif c0 == "token":
        name = str(d.get("name") or "").strip()[:60]
        if not name:
            raise ValueError("Falta o nome da ficha.")
        if len(t["cards"]) > 2000:
            raise ValueError("Fichas a mais na mesa.")
        cid = _new_id(t)
        c = t["cards"][str(cid)] = {"id": cid, "n": name, "o": me, "s": me, "z": "battlefield", "tok": True, "x": _pos(d.get("x")), "y": _pos(d.get("y"))}
        t["zones"][me]["battlefield"].append(cid)
        _log(t, me, "token", name=name)
    elif c0 in ("life", "poison"):
        who = _num(d.get("seat"), 0, len(t["seats"]) - 1, me)
        s = t["seats"][who]
        s[c0] = _num(s[c0] + _num(d.get("d"), -999, 999), -999 if c0 == "life" else 0, 9999)
        _log(t, me, c0, p=who, d=_num(d.get("d"), -999, 999), v=s[c0])
    elif c0 == "dice":
        types = [x for x in (d.get("types") or []) if x in DICE][:4]
        if not types:
            raise ValueError("Que dados?")
        v = [RNG.randint(1, DICE[x]) for x in types]
        # o lançamento: semente e, se veio, o gesto (posição e velocidade ao largar, na mesa de quem lançou); todos os
        # ecrãs correm a mesma física com isto e os dados assentam nos valores daqui
        thr = d.get("thr") if isinstance(d.get("thr"), dict) else {}
        vec = lambda k, m: [round(max(-m, min(m, float(x))), 3) for x in thr[k]][:3] if isinstance(thr.get(k), list) and len(thr[k]) == 3 and all(isinstance(x, (int, float)) for x in thr[k]) else None  # noqa: E731
        g = {"x": vec("x", 30), "v": vec("v", 60)}
        t["roll"] = {"n": (t["roll"] or {}).get("n", 0) + 1, "s": me, "types": types, "v": v, "seed": RNG.randrange(1, 2 ** 31),
                     **({"thr": g} if g["x"] and g["v"] else {})}
        _log(t, me, "dice", types=types, v=v)
    elif c0 == "reveal":
        c = need()
        if c["z"] != "hand":
            raise ValueError("Só se revelam cartas da mão.")
        c["r"] = not c.get("r")
        if c["r"]:
            _log(t, me, "reveal", name=c["n"])
    elif c0 == "revealhand":
        hand = [t["cards"][str(x)] for x in t["zones"][me]["hand"]]
        on = not all(c.get("r") for c in hand)
        for c in hand:
            c["r"] = on
        if on:
            _log(t, me, "revealhand", names=[c["n"] for c in hand])
    elif c0 == "peek":
        seat["peek"] = _num(d.get("n"), 0, len(t["zones"][me]["library"]))
        if seat["peek"]:
            _log(t, me, "peek", n=seat["peek"])
    elif c0 == "pass":
        n = len(t["seats"])
        nxt = next((x % n for x in range(t["active"] + 1, t["active"] + n + 1) if not t["seats"][x % n]["out"]), t["active"])
        t["active"], t["turn"] = nxt, t["turn"] + 1
        _log(t, me, "pass", p=nxt, turn=t["turn"])
    elif c0 == "concede":
        seat["out"] = True
        _log(t, me, "concede")
        left = [i for i, s2 in enumerate(t["seats"]) if not s2["out"]]
        if len(t["seats"]) > 1 and len(left) == 1:  # desistir = perder: sobra um, ganhou
            _decide(t, left[0])
    elif c0 in ("result", "agree", "dispute"):  # resultado combinado entre os jogadores (ou marcado por quem aloja)
        if len(t["seats"]) < 2:
            raise ValueError("A solo não há resultado.")
        if c0 == "dispute":
            t.pop("res", None)
            _log(t, me, "dispute")
        elif c0 == "result":
            w = d.get("w")
            if w is not None and w not in range(len(t["seats"])):
                raise ValueError("Quem ganhou?")
            people = {s2["by"] for s2 in t["seats"]}
            if seat["by"] == "host" or len(people) == 1:  # quem aloja decide; quem joga os dois lados também
                _decide(t, w, me)
            else:
                t["res"] = {"w": w, "ok": [seat["by"]]}
                _log(t, me, "propose", p=w)
        else:
            r = t.get("res")
            if not r:
                raise ValueError("Não há resultado para confirmar.")
            if seat["by"] not in r["ok"]:
                r["ok"].append(seat["by"])
            if {s2["by"] for s2 in t["seats"]} <= set(r["ok"]):
                _decide(t, r["w"], me)
    elif c0 == "react":
        e = d.get("e")
        ent = next((x for x in t["log"] if x.get("id") == d.get("i")), None)
        if e not in REACT or not ent:
            raise ValueError("Reação inválida.")
        re_ = ent.setdefault("re", {})
        who = re_.setdefault(e, [])
        who.remove(me) if me in who else who.append(me)
        if not who:
            del re_[e]
    elif c0 == "pen":
        pts = d.get("pts")
        if not isinstance(pts, list) or not 0 < len(pts) <= 80:
            raise ValueError("Traço inválido.")
        try:
            pts = [[_num(r, -1, 3), round(max(-0.2, min(1.2, float(x))), 3), round(max(-0.2, min(1.2, float(y))), 3)] for r, x, y in pts]
        except (TypeError, ValueError):
            raise ValueError("Traço inválido.")
        now = time.time()
        t["pn"] = t.get("pn", 0) + 1
        t["pen"] = [x for x in t.get("pen", []) if x["ts"] > now - PEN_LIFE][-300:] + [
            {"pn": t["pn"], "s": me, "sid": _num(d.get("sid"), 0, 2 ** 31), "pts": pts, "col": d.get("col") if d.get("col") in PEN else PEN[me % len(PEN)], "ts": now}]
    elif c0 == "chat":
        txt = re.sub(r"\s+", " ", str(d.get("text") or "")).strip()[:300]
        if not txt:
            return
        _log(t, me, "chat", text=txt)
    elif c0 == "close":
        if seat["by"] != "host":
            raise PermissionError("Só quem aloja pode terminar a mesa.")
        t["status"] = "ended"
        _log(t, me, "close")
    else:
        raise ValueError("Comando desconhecido.")


def route(db, method, path, owner, body, who, since=0, seat=None):
    """GET /api/freetables/<id>?since=N (espera até 25 s por novidades) | POST /api/freetables/<id> {c, …}.
    `who` = 'host' (o dono) ou 'guest:<id>'; só quem está sentado à mesa a vê."""
    m = PATH.match(path)
    if not m or method not in ("GET", "POST"):
        return 404, {"erro": "rota desconhecida"}
    t = _load(db, m.group(1))
    if not t or t["owner"] != owner or _seat(t, who) is None:
        return 404, {"erro": "Esta mesa não existe ou não estás sentado nela."}
    me = _seat(t, who, seat)
    if method == "GET":
        end = time.time() + 25
        with COND:
            while t["seq"] <= since and time.time() < end:
                COND.wait(timeout=end - time.time())
            return 200, view(t, me)
    if not isinstance(body, dict):
        return 400, {"erro": "Comando inválido."}
    with COND:
        try:
            apply(t, me, body)
        except PermissionError as e:
            return 403, {"erro": str(e)}
        except ValueError as e:
            return 400, {"erro": str(e)}
        t["seq"] += 1
        t["ts"] = time.time()
        COND.notify_all()
        if body.get("c") != "pen":  # a caneta é passageira: não vale uma escrita na base de dados
            with db() as con:  # ponytail: grava a mesa inteira a cada jogada (≈ 30 KB), sob o mesmo cadeado; diferenças só se um dia pesar
                _save(con, t)
        return 200, view(t, me)


def selfcheck():
    """Privacidade, zonas consistentes, espera longa e fronteira dos convidados (base de dados temporária)."""
    import os, sqlite3, tempfile
    path = os.path.join(tempfile.mkdtemp(prefix="grim-ml-"), "t.db")
    db = lambda: sqlite3.connect(path)  # noqa: E731
    deck = lambda n, f="modern", cmd=(): {"name": n, "format": f, "commanders": list(cmd), "main": {f"{n} Card {i}": 4 for i in range(15)}}  # noqa: E731
    with db() as con:
        tid = create(con, "hubert", "QA", [{"by": "host", "name": "Hubert", "deck": deck("A")},
                                          {"by": "guest:rui", "name": "Rui", "deck": deck("B", "commander", ["B Boss"])}])
    T.clear()  # vem da SQLite como depois de um reinício
    t = _load(db, tid)

    def consistent():
        seen = {}
        for s, z in enumerate(t["zones"]):
            for k in ZONES:
                for cid in z[k]:
                    assert cid not in seen, ("carta em duas zonas", cid)
                    seen[cid] = 1
                    c = t["cards"][str(cid)]
                    assert (c["s"], c["z"]) == (s, k) and c["id"] == cid, c
        assert len(seen) == len(t["cards"]), "carta fora de qualquer zona"
    consistent()
    assert [s["life"] for s in t["seats"]] == [20, 40] and len(t["zones"][1]["command"]) == 1
    assert len(t["zones"][0]["hand"]) == 7 and len(t["zones"][0]["library"]) == 53

    def call(method, who, body=None, since=0, owner="hubert"):
        return route(db, method, f"/api/freetables/{tid}", owner, body, who, since)
    st, v = call("GET", "guest:rui")
    assert st == 200 and v["me"] == 1, v
    host_names = {c["n"] for c in (t["cards"][str(x)] for z in ("hand", "library") for x in t["zones"][0][z])}
    blob = json.dumps(v)
    assert not any(n in blob for n in host_names), "o convidado viu cartas da mão/biblioteca do anfitrião"
    assert all("n" not in c for c in v["seats"][0]["hand"]) and v["seats"][0]["library"] == 53 and all("n" in c for c in v["seats"][1]["hand"])
    assert call("GET", "guest:outro")[0] == 404 and call("GET", "host", owner="outro")[0] == 404  # fora da mesa / outro anfitrião
    h0 = t["zones"][0]["hand"][0]
    assert call("POST", "guest:rui", {"c": "move", "id": h0, "to": "graveyard"})[0] == 403  # mão alheia: não
    assert call("POST", "guest:rui", {"c": "move", "id": t["zones"][0]["library"][0], "to": "hand"})[0] == 403
    # espera longa: a jogada do anfitrião acorda o convidado
    got = {}
    th = threading.Thread(target=lambda: got.update(r=call("GET", "guest:rui", since=v["seq"])))
    th.start(); time.sleep(0.2)
    assert th.is_alive(), "a espera longa devia ficar à espera"
    st, hv = call("POST", "host", {"c": "move", "id": h0, "to": "battlefield", "x": 0.3, "y": 0.4, "down": True})
    th.join(3)
    assert st == 200 and not th.is_alive() and got["r"][1]["seq"] > v["seq"]
    bf = got["r"][1]["seats"][0]["battlefield"]
    assert bf[0]["d"] and "n" not in bf[0] and "n" in hv["seats"][0]["battlefield"][0]  # virada para baixo: só o dono a vê
    call("POST", "host", {"c": "face", "id": h0})
    assert "n" in call("GET", "guest:rui")[1]["seats"][0]["battlefield"][0]
    assert call("POST", "guest:rui", {"c": "tap", "id": h0})[0] == 200 and t["cards"][str(h0)]["t"]  # campo: qualquer um mexe
    call("POST", "host", {"c": "counter", "id": h0, "k": "+1/+1", "d": 2})
    call("POST", "host", {"c": "counter", "id": h0, "k": "+1/+1", "d": -2})
    assert not t["cards"][str(h0)].get("k")
    # para a biblioteca: id novo e escondido de novo
    name = t["cards"][str(h0)]["n"]
    call("POST", "guest:rui", {"c": "move", "id": h0, "to": "library"})
    assert str(h0) not in t["cards"] and t["cards"][str(t["zones"][0]["library"][0])]["n"] == name
    consistent()
    # olhar para o topo: só o dono vê; revelar a mão: todos veem
    call("POST", "host", {"c": "peek", "n": 3})
    assert len(call("GET", "host")[1]["seats"][0]["top"]) == 3 and "top" not in call("GET", "guest:rui")[1]["seats"][0]
    top = t["zones"][0]["library"][0]
    tn = t["cards"][str(top)]["n"]
    assert call("POST", "host", {"c": "move", "id": top, "to": "library", "bottom": True})[0] == 200  # scry para o fundo
    assert t["cards"][str(t["zones"][0]["library"][-1])]["n"] == tn and t["seats"][0]["peek"] == 2
    assert call("POST", "host", {"c": "move", "id": t["zones"][0]["library"][5], "to": "hand"})[0] == 403  # fora do que espreita
    call("POST", "host", {"c": "revealhand"})
    assert all("n" in c for c in call("GET", "guest:rui")[1]["seats"][0]["hand"])
    call("POST", "host", {"c": "revealhand"})
    assert all("n" not in c for c in call("GET", "guest:rui")[1]["seats"][0]["hand"])
    # mulligan, fichas, vida, dados, passar a vez
    call("POST", "guest:rui", {"c": "mulligan"})
    assert len(t["zones"][1]["hand"]) == 7 and len(t["zones"][1]["library"]) == 53
    st, rv = call("POST", "guest:rui", {"c": "token", "name": "Goblin", "x": 0.5, "y": 0.5})
    tok = rv["seats"][1]["battlefield"][-1]
    assert tok["tok"] and tok["n"] == "Goblin"
    call("POST", "guest:rui", {"c": "move", "id": tok["id"], "to": "graveyard"})
    assert str(tok["id"]) not in t["cards"]  # a ficha desaparece
    call("POST", "guest:rui", {"c": "life", "seat": 0, "d": -3})
    assert t["seats"][0]["life"] == 17
    st, rv = call("POST", "host", {"c": "dice", "types": ["d20", "moeda"]})
    assert 1 <= rv["roll"]["v"][0] <= 20 and rv["roll"]["v"][1] in (1, 2) and call("GET", "guest:rui")[1]["roll"] == rv["roll"]
    st, rv = call("POST", "guest:rui", {"c": "dice", "types": ["d6"], "thr": {"x": [1, 2.4, 3], "v": [0, 1.5, -20]}})
    assert rv["roll"]["thr"] == {"x": [1, 2.4, 3], "v": [0, 1.5, -20]} and rv["roll"]["seed"] and rv["roll"]["s"] == 1
    assert "thr" not in call("POST", "host", {"c": "dice", "types": ["d6"], "thr": {"x": "rm", "v": [1]}})[1]["roll"]
    # conversa com reações; caneta passageira (não se grava, desaparece do estado)
    st, rv = call("POST", "guest:rui", {"c": "chat", "text": "olha o @[Lightning Bolt]!"})
    cid = rv["log"][-1]["id"]
    call("POST", "host", {"c": "react", "i": cid, "e": "😂"})
    assert t["log"][-1]["re"] == {"😂": [0]} and call("POST", "host", {"c": "react", "i": cid, "e": "💩"})[0] == 400
    call("POST", "host", {"c": "react", "i": cid, "e": "😂"})
    assert "😂" not in t["log"][-1]["re"]
    st, rv = call("POST", "host", {"c": "pen", "sid": 7, "col": "#ff5c8a", "pts": [[0, 0.5, 0.5], [-1, 0.2, 9]]})
    assert st == 200 and rv["pen"][-1]["pts"] == [[0, 0.5, 0.5], [-1, 0.2, 1.2]], rv
    assert call("GET", "guest:rui")[1]["pen"][-1]["col"] == "#ff5c8a"
    assert call("POST", "host", {"c": "pen", "pts": []})[0] == 400
    with db() as con:
        assert "pen" not in json.loads(con.execute("SELECT state FROM freetables WHERE id=?", (tid,)).fetchone()[0])
    t["pen"][-1]["ts"] -= PEN_LIFE + 1
    assert not call("GET", "guest:rui")[1]["pen"]
    # a solo: novo turno (desvira + compra), adversário imaginário, recomeçar com o comandante na zona de comando
    with db() as con:
        sid = create(con, "hubert", "Solo", [{"by": "host", "name": "H", "deck": deck("C", "commander", ["C Boss"])}], solo=True)
    so = T[sid]
    assert len(so["seats"]) == 1 and so["seats"][0]["life"] == 40
    boss = so["zones"][0]["command"][0]
    apply(so, 0, {"c": "move", "id": boss, "to": "battlefield", "x": 0.5, "y": 0.5})
    apply(so, 0, {"c": "token", "name": "Spirit"}); apply(so, 0, {"c": "newturn"}); apply(so, 0, {"c": "gf", "d": -5})
    assert so["turn"] == 2 and len(so["zones"][0]["hand"]) == 8 and so["gf"] == 15
    apply(so, 0, {"c": "newgame"})
    assert so["zones"][0]["command"] == [boss] and not so["zones"][0]["battlefield"] and len(so["zones"][0]["hand"]) == 7 and so["gf"] == 20 and so["turn"] == 1
    assert len(so["cards"]) == 61  # 60 + o comandante; a ficha foi-se
    try:
        apply(t, 0, {"c": "newgame"})
        raise AssertionError("recomeçar só a solo")
    except ValueError:
        pass
    # resultado: o convidado propõe, o anfitrião confirma (ou decide); desistir = perder
    with db() as con:
        rid = create(con, "hubert", "R", [{"by": "host", "name": "H", "deck": deck("A")}, {"by": "guest:rui", "name": "Rui", "deck": deck("B")}])
    rt = T[rid]
    apply(rt, 1, {"c": "result", "w": 1})
    assert rt["res"] == {"w": 1, "ok": ["guest:rui"]} and "result" not in rt and result(rid)["ended"] is False
    apply(rt, 0, {"c": "agree"})
    assert rt["result"] == {"w": 1} and result(rid) == {"ended": True, "w": 1, "turns": 1}
    with db() as con:
        rid = create(con, "hubert", "R2", [{"by": "host", "name": "H", "deck": deck("A")}, {"by": "host", "name": "H", "deck": deck("B")}])
    rt = T[rid]  # os dois lados do mesmo jogador: escolhe o lugar e desistir do outro dá a vitória
    assert route(db, "GET", f"/api/freetables/{rid}", "hubert", None, "host", 0, 1)[1]["me"] == 1
    route(db, "POST", f"/api/freetables/{rid}", "hubert", {"c": "concede"}, "host", 0, 1)
    assert result(rid)["w"] == 0
    call("POST", "host", {"c": "pass"})
    assert t["active"] == 1 and t["turn"] == 2
    assert call("POST", "host", {"c": "rm -rf"})[0] == 400 and call("POST", "guest:rui", {"c": "close"})[0] == 403
    consistent()
    # o registo nunca diz o nome de uma carta escondida
    hidden = [e for e in t["log"] if e["k"] == "move" and e["fr"] in ("hand", "library") and e["to"] in ("hand", "library")]
    assert hidden and not any(e["name"] for e in hidden), t["log"]
    print("selfcheck mesa livre ok")


if __name__ == "__main__":
    selfcheck()
