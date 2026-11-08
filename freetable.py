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
from collections import Counter

import sim

T = {}                       # id -> mesa (em memória; a SQLite guarda a cópia)
COND = threading.Condition()
ZONES = ("library", "hand", "graveyard", "exile", "command", "battlefield")
PUBLIC = ("graveyard", "exile", "command")
DICE = {"d6": 6, "d20": 20, "moeda": 2}
PEN = ("#ffd166", "#ff5c8a", "#4cc9f0", "#80ed99", "#ffffff", "#c77dff")  # cores da caneta
REACT = ("👍", "😂", "😮", "🔥", "😭", "🤝")
# padrões do tapete de cada jogador (o desenho é CSS: .bside[data-mat] em index.css; MATS em web/src/Board.jsx)
MATS = ("pontos", "riscas", "xadrez", "grelha", "linho", "escamas", "arcano", "oceano", "brasas", "floresta")
# a esfera da vida de cada jogador (estilo e animação; «auto» = pelo deck): ORB_T/ORB_A em web/src/fpprefs.js
ORB_T = ("auto", "verde", "oceano", "brasa", "vazio", "ouro", "gelo", "prisma", "tempestade", "sangue")
ORB_A = ("auto", "calmo", "turbilhao", "pulsar", "faiscas")
LIVE_K = ("orb", "die", "card", "end")  # o que se mostra ao vivo aos outros enquanto alguém lhe mexe
SIDE_T = 180  # segundos para o sideboard entre jogos de uma série; depois joga cada um com a lista que tem


def _frac(x, lo=-0.2, hi=1.2):
    try:
        return max(lo, min(hi, round(float(x), 4)))
    except (TypeError, ValueError):
        return 0.5


# as fases do turno (mesa livre): Espaço/Enter avança; depois do fim passa a vez
STEPS = ("untap", "upkeep", "draw", "main1", "combat", "main2", "end")
PTR_Z = ("hand", "field", "graveyard", "exile", "library", "command", "stack", "life", "table")  # zonas do cursor (nunca a carta)
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


def _find(con, tid):
    """A mesa pelo id: em memória ou na base de dados (None se não há)."""
    with COND:
        t = T.get(tid) if tid else None
    if t is None and tid and con is not None:
        r = con.execute("SELECT state FROM freetables WHERE id=?", (tid,)).fetchone()
        t = r and json.loads(r[0])
    return t


def lists(con, tid):
    """As listas com que a mesa jogou ({lugar: {main, side, cm}}): o torneio guarda-as para reabrir uma mesa perdida a meio da série."""
    return (_find(con, tid) or {}).get("lists")


def create(con, owner, name, seats, solo=False, first=0, side=0, prev=None, was=None, giant=False, keep=False):  # keep: guardar em «Os meus jogos» no fim  # first: quem começa (a moeda do lobby)
    # giant: Two-Headed Giant (4 lugares: 0+1 contra 2+3) — vida da equipa 30 e veneno 15 partilhados, turnos da equipa
    """seats = [{by, name, deck: {name, format, main, side, commanders}}] -> id da mesa (já com 7 cartas na mão de cada um).
    solo: um só lugar, para testar um deck (goldfish), com a vida de um adversário imaginário.
    side = o número do jogo (2+) de uma série (tournament.open_table; 0 = sem sideboard): antes de dar as cartas cada lugar com sideboard escolhe a lista
    (comando «side»); prev = a mesa do jogo anterior, de onde vêm as listas escolhidas (e que fica a apontar para esta);
    was = as listas do jogo anterior guardadas à parte (lists()), para quando essa mesa já não existe."""
    init(con)
    if not (1 if solo else 2) <= len(seats) <= (1 if solo else 4):
        raise ValueError("A mesa livre leva entre 2 e 4 jogadores.")
    if giant and len(seats) != 4:
        raise ValueError("O Two-Headed Giant é para 4 jogadores (duas equipas de dois).")
    pt = _find(con, prev)
    last = (pt or {}).get("lists") or was or {}
    t = {"id": secrets.token_hex(6), "owner": owner, "name": str(name or "Mesa livre")[:80], "seq": 1, "ts": time.time(),
         "status": "playing", "turn": 1, "active": first if 0 <= first < len(seats) else 0, "seats": [], "cards": {}, "zones": [], "log": [], "roll": None,
         "lists": {}, **({"solo": True, "gf": 20} if solo else {}), **({"teams": [0, 0, 1, 1]} if giant else {})}
    for i, s in enumerate(seats):
        d = s["deck"] or {}
        cmdrs = [str(c) for c in (d.get("commanders") or []) if c][:2]
        cmd = d.get("format") in sim.GAME_TYPE and bool(cmdrs)
        main = dict(d.get("main") or {})
        for c in cmdrs:  # o comandante pode vir também no main: fica só na zona de comando
            if main.get(c):
                main[c] -= 1
        lst = {"main": _clip(main), "cm": cmdrs}
        sd = _clip(d.get("side") or {}) if not cmdrs else {}
        if sd:  # a lista da série: a escolhida no jogo anterior (se ainda for a mesma pilha de cartas) ou a guardada
            base = {"main": lst["main"], "side": sd}
            w = last.get(str(i))
            lst.update(w if w and _pool(w) == _pool(base) else base, cm=cmdrs)
            if side and not solo:
                t.setdefault("sb", {})[str(i)] = {"ok": False, "base": base}
        t["lists"][str(i)] = lst
        t["zones"].append({k: [] for k in ZONES})
        t["seats"].append({"by": s["by"], "name": str(s.get("name") or "?")[:40], "deck": str(d.get("name") or "")[:80],
                           "format": d.get("format"), "life": 40 if cmd else 20, "life0": 40 if cmd else 20, "poison": 0, "energy": 0, "cd": {}, "mk": [],
                           "out": False, "peek": 0, "arts": sim.art_map(d)})  # a arte escolhida no deck
    if keep:
        t["keep"] = True
    if giant:  # 2HG: a vida da equipa começa em 30 (regra 810.9a)
        for s2 in t["seats"]:
            s2["life"] = s2["life0"] = 30
        t["active"] = (first if 0 <= first < 4 else 0) // 2 * 2  # a equipa que começa: o 1.º lugar dela
    if t.get("sb"):  # sideboard primeiro: as cartas só se dão quando todos estão prontos (ou o tempo acaba)
        t.update(status="side", sideTo=time.time() + SIDE_T, game=int(side))
        _log(t, None, "sidestart", n=SIDE_T)
    else:
        _begin(t)
    with COND:
        T[t["id"]] = t
    _save(con, t)
    if pt:  # quem ainda está na mesa do jogo anterior vê o «jogo seguinte» e passa para esta
        with COND:
            pt["next"] = t["id"]
            pt["seq"] += 1
            COND.notify_all()
        _save(con, pt)
    return t["id"]


def _clip(p):
    """{nome: cópias} de uma lista que vem de fora: nomes curtos, cópias inteiras entre 1 e 250."""
    out = {}
    for n, q in (p or {}).items():
        try:
            q = int(q or 0)
        except (TypeError, ValueError):
            continue
        if q > 0:
            out[str(n)[:150]] = min(q, 250)
    return out


def _pool(d):
    return Counter(d.get("main") or {}) + Counter(d.get("side") or {})


def _begin(t):
    """As cartas de cada lugar (a lista da série) entram na biblioteca, baralha-se e cada um compra 7."""
    for i, lst in sorted(t["lists"].items(), key=lambda x: int(x[0])):
        i = int(i)
        z = t["zones"][i]
        names = [n for n, k in lst["main"].items() for _ in range(k)][:300]
        for n, zone in [(n, "library") for n in names] + [(c, "command") for c in lst.get("cm") or []]:
            cid = _new_id(t)
            t["cards"][str(cid)] = {"id": cid, "n": str(n)[:150], "o": i, "s": i, "z": zone, **({"cm": True} if zone == "command" else {})}
            z[zone].append(cid)
        _deal(t, i)
    t["status"] = "playing"
    t.pop("sb", None)
    t.pop("sideTo", None)
    _log(t, None, "start")


def _tick(t):
    """Sideboard com o tempo acabado: joga cada um com a lista que tem. True se a mesa mudou (é preciso gravá-la)."""
    if t["status"] != "side" or time.time() < t["sideTo"]:
        return False
    _log(t, None, "sidetime")
    _begin(t)
    t["seq"] += 1
    COND.notify_all()
    return True


def _clean(c):
    """Estado de mesa a zeros (a carta entrou numa zona nova)."""
    for k in ("x", "y", "t", "d", "f", "k", "atk", "atc", "r", "at", "ph", "sp", "tg", "blk", "nt"):
        c.pop(k, None)  # (cm = comandante e cc = vezes lançado da zona de comando ficam)


def _save(con, t):
    st = {k: v for k, v in t.items() if k not in ("pen", "live", "ptr", "snapsig")}  # a caneta e o «ao vivo» são passageiros: não se gravam
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
    return {"ended": "result" in t, "w": (t.get("result") or {}).get("w"), "turns": t["turn"], "snaps": list(t.get("snaps") or []),
            "names": [s["name"] for s in t["seats"]]}


ON_KEEP = None  # server.py: ON_KEEP(dono, jogo) quando acaba uma mesa de uma sala (create keep=True): «Os meus jogos»


def _kept(t):
    """A mesa acabou: o jogo que vai para «Os meus jogos» do dono (o formato das réplicas do playnet, ft = mesa livre)."""
    t["kept"] = True
    sk, w = "abcd", t["result"].get("w")
    host = next((i for i, s in enumerate(t["seats"]) if s["by"] == "host"), 0)
    return {"names": {sk[i]: s["deck"] or s["name"] for i, s in enumerate(t["seats"])}, "players": {sk[i]: s["name"] for i, s in enumerate(t["seats"])},
            "winner": sk[w] if w is not None else "draw", "turns": t["turn"], "snaps": list(t["snaps"]), "ft": True, "me": sk[host], "ts": time.time()}


SNAPS = 300  # fotografias da mesa por jogo, no máximo (tira-se do meio); ponytail: vão no JSON da mesa a cada _save (~1 MB no máximo), tabela própria se pesar


def _snap(t):
    """Uma fotografia da mesa para a réplica (só o que todos veem: as mãos só contadas, cartas viradas sem nome)."""
    card = lambda cid: t["cards"][str(cid)]  # noqa: E731
    seats = []
    for i, s in enumerate(t["seats"]):
        z = t["zones"][i]
        bf = []
        for c in map(card, z["battlefield"]):
            if c.get("sp"):
                continue
            x = {"id": c["id"], **({"n": c["n"]} if not c.get("d") else {})}
            x.update({k: c[k] for k in ("t", "k", "at", "tok", "atk", "blk") if c.get(k) is not None and c.get(k) is not False and c.get(k) != {}})
            bf.append(x)
        seats.append({"name": s["name"], "life": s["life"], "psn": s.get("poison", 0), "lib": len(z["library"]), "hand": len(z["hand"]), "bf": bf,
                      "gy": [card(x)["n"] for x in z["graveyard"]], "ex": [card(x)["n"] for x in z["exile"]], **({"out": True} if s.get("out") else {})})
    st = {"turn": t["turn"], "active": t["active"], "seats": seats}
    sig = json.dumps(st, sort_keys=True)
    if sig == t.get("snapsig"):
        return
    t["snapsig"] = sig
    e = t["log"][-1] if t["log"] else {}
    who = t["seats"][e["s"]]["name"] if isinstance(e.get("s"), int) and 0 <= e["s"] < len(t["seats"]) else ""
    sn = t.setdefault("snaps", [])
    sn.append({"st": st, "ev": [t["turn"], who, e.get("k") or "", str(e.get("name") or "")]})  # o texto do passo faz-se no cliente (traduzido: fpboard.ftTxt)
    if len(sn) > SNAPS:
        del sn[len(sn) // 2]


def _public(c):
    z = c["z"]
    return z in PUBLIC or (z == "battlefield" and not c.get("d")) or (z == "hand" and c.get("r"))


def _sees(t, c, me):
    z = c["z"]
    if z == "library":
        own, lib, so = c["o"], t["zones"][c["o"]]["library"], t["seats"][c["o"]]
        if so.get("rt") and lib and lib[0] == c["id"]:  # «revelar sempre o topo» (Courser of Kruphix, Future Sight…)
            return True
        if so.get("ls") and me != own:  # a biblioteca mostrada aos outros (Telepathy-like, ou só para mostrar)
            return True
        return own == me and c["id"] in lib[:t["seats"][me]["peek"]]
    if z == "hand":  # a mão: o dono, as reveladas a todos e quem está a olhar para ela (lookhand: só esse)
        return c["o"] == me or bool(c.get("r")) or t["seats"][me].get("look") == c["s"]
    if z == "battlefield" and c.get("d"):
        return me in (c["o"], c["s"])
    return True


def _card(t, cid, me):
    c = t["cards"][str(cid)]
    out = {"id": c["id"], "o": c["o"]}
    if _sees(t, c, me):
        out["n"] = c["n"]
    for k in ("x", "y", "t", "d", "f", "k", "atk", "atc", "r", "tok", "at", "ph", "cm", "cc", "sp", "tg", "blk", "nt"):
        if c.get(k) not in (None, False, {}):
            out[k] = c[k]
    return out


def view(t, me):
    """O que o jogador `me` pode ver (o servidor nunca manda nomes escondidos)."""
    seats = []
    for i, s in enumerate(t["seats"]):
        z = t["zones"][i]
        v = {**{k: s[k] for k in ("name", "deck", "format", "life", "poison", "out")}, "energy": s.get("energy", 0), "cd": s.get("cd") or {}, "mat": s.get("mat"), "orb": s.get("orb"),
             "mk": s.get("mk") or [], "me": i == me, "library": len(z["library"]), "arts": s.get("arts") or {},
             "hand": [_card(t, c, me) for c in z["hand"]], **{k: [_card(t, c, me) for c in z[k]] for k in ("graveyard", "exile", "command", "battlefield")}}
        if s.get("look") is not None:  # público: todos sabem quem está a olhar para a mão de quem (as cartas não)
            v["look"] = s["look"]
        if s.get("rt") and z["library"]:
            v["rtop"] = _card(t, z["library"][0], me)
        v["rt"], v["ls"] = bool(s.get("rt")), bool(s.get("ls"))
        if s.get("ls") and i != me:
            v["libv"] = [_card(t, c, me) for c in z["library"]]
        if i == me and s["peek"]:
            v["top"] = [_card(t, c, me) for c in z["library"][:s["peek"]]]
            v["srch"] = bool(s.get("srch"))
        seats.append(v)
    return {"id": t["id"], "name": t["name"], "seq": t["seq"], "status": t["status"], "turn": t["turn"], "active": t["active"],
            "step": t.get("step", 3), "auto": t["seats"][me].get("auto", True), "me": me, **({"teams": t["teams"]} if t.get("teams") else {}), "host": t["seats"][me]["by"] == "host", "mine": [i for i, s in enumerate(t["seats"]) if s["by"] == t["seats"][me]["by"]],
            "res": t.get("res"), "result": t.get("result"), "solo": bool(t.get("solo")), "gf": t.get("gf"), "day": t.get("day"), "seats": seats, "log": t["log"][-120:], "roll": t["roll"],
            "pen": [x for x in t.get("pen", []) if x["ts"] > time.time() - PEN_LIFE], "next": t.get("next"),
            # a escolher o sideboard: de todos só se sabe quem já está pronto; a lista (e a guardada) só a dos meus lugares
            **({"side": {"g": t.get("game"), "to": round(max(0.0, t["sideTo"] - time.time())), "ok": {i: x["ok"] for i, x in t["sb"].items()},
                         "mine": {i: {"deck": {k: t["lists"][i][k] for k in ("main", "side")}, "base": x["base"]}
                                  for i, x in t["sb"].items() if t["seats"][int(i)]["by"] == t["seats"][me]["by"]}}} if t["status"] == "side" else {}),
            # o que os outros estão a agarrar agora (esfera, dado, carta): posição em frações da mesa, na vista de quem mexe
            "live": {str(i): {k: v for k, v in x.items() if k != "ts"} for i, x in (t.get("live") or {}).items() if i != me and x["ts"] > time.time() - 2},
            # o cursor de cada outro jogador (a «mãozinha»): onde anda e há quanto tempo parou; some ao fim de 8 s
            "ptr": {str(i): {**{k: v for k, v in x.items() if k != "ts"}, "age": round(time.time() - x["ts"], 1)} for i, x in (t.get("ptr") or {}).items() if i != me and x["ts"] > time.time() - 8}}


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


def _leave(t, c):
    """A carta sai do campo: o que estava preso a ela (auras, equipamentos) fica solto."""
    for x in t["zones"]:
        for cid in x["battlefield"]:
            o = t["cards"][str(cid)]
            if o.get("at") == c["id"]:
                o.pop("at", None)


DESIG = ("monarch", "initiative", "blessing")  # monarca e iniciativa: só um jogador de cada vez; bênção da cidade: para sempre


def _draw(t, me, n):
    z = t["zones"][me]
    n = min(n, len(z["library"]))
    for _ in range(n):
        c = t["cards"][str(z["library"][0])]
        _take(t, c)
        _put(t, c, me, "hand")
    t["seats"][me]["peek"] = max(0, t["seats"][me]["peek"] - n)
    return n


def _mine_active(t, me):
    a = t["active"]
    return t["seats"][a]["by"] == t["seats"][me]["by"] or me in _mates(t, a)  # 2HG: os dois da equipa mexem nas fases


def _mates(t, i):
    """2HG: os parceiros de equipa do lugar i (sem ele); [] fora do Two-Headed Giant."""
    tm = t.get("teams")
    return [k for k in range(len(t["seats"])) if tm and k != i and tm[k] == tm[i]] if tm else []


def _step(t, to):
    """Entrar numa fase. Com o automático de quem tem a vez: desvirar desvira tudo; comprar compra 1 e segue para a principal.
    Depois do combate os atacantes deixam de o ser."""
    a = t["active"]
    t["step"] = to
    auto = t["seats"][a].get("auto", True)
    if STEPS[to] == "untap" and auto:
        _untap(t, a)
    if STEPS[to] == "draw" and auto:
        if t["turn"] > 1:  # quem começa não compra no primeiro turno
            _log(t, a, "draw", n=_draw(t, a, 1))
        t["step"] = STEPS.index("main1")
    if to > STEPS.index("combat"):
        for c in t["cards"].values():
            c.pop("atk", None); c.pop("atc", None); c.pop("blk", None)


def _untap(t, i):
    for cid in t["zones"][i]["battlefield"]:
        c = t["cards"][str(cid)]
        c.pop("t", None); c.pop("atk", None); c.pop("atc", None); c.pop("blk", None)


def _turn_start(t, i):
    """Começo do turno de i: com o automático desvira e compra (fica na principal); sem ele fica no desvirar."""
    if t["seats"][i].get("auto", True):
        _untap(t, i)
        _log(t, i, "newturn", n=_draw(t, i, 1), turn=t["turn"])
        t["step"] = STEPS.index("main1")
    else:
        t["step"] = 0


def apply(t, me, d):
    """Um comando do jogador `me`. Erros de uso -> ValueError (a mesa fica como estava)."""
    c0 = str(d.get("c") or "")
    seat = t["seats"][me]
    if t["status"] == "side" and c0 in ("side", "chat", "react", "close"):  # a escolher o sideboard: só isto (ainda não há cartas; a conversa sim)
        pass
    elif t["status"] != "playing" or c0 == "side":
        raise ValueError("O sideboard já fechou." if c0 == "side" else "Esta mesa já terminou." if t["status"] == "ended" else "Ainda se está a escolher o sideboard.")
    card = None
    if "id" in d:
        card = t["cards"].get(str(d.get("id")))
        if not card:
            raise ValueError("Essa carta já não está lá.")
        # nas zonas escondidas (mão, biblioteca) só mexe o dono; nas públicas qualquer um (é entre amigos)
        # a exceção: quem está a olhar para a mão de outro (Thoughtseize, Duress, Kitesail Freebooter…) tira de lá a
        # carta escolhida para o cemitério, o exílio ou a biblioteca dele
        took = c0 == "move" and card["z"] == "hand" and seat.get("look") == card["s"] and d.get("to") in ("graveyard", "exile", "library")
        if card["z"] in ("hand", "library") and card["o"] != me and not took:
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
        # at: largada em cima de outra carta do campo (aura, equipamento): entra já presa a ela, sem passar por uma casa livre
        host = t["cards"].get(str(d.get("at"))) if d.get("at") is not None else None
        if d.get("at") is not None and (to != "battlefield" or c["z"] == "battlefield" or not host or host["z"] != "battlefield" or host["id"] == c["id"]):
            raise ValueError("Só se prende a outra carta do campo.")
        was_pub, src = _public(c), c["z"]
        if to == "battlefield":
            dest = _num(d.get("seat"), 0, len(t["seats"]) - 1, c["s"] if src == "battlefield" else me)
            if src == "battlefield" and dest == c["s"]:  # só mudar de sítio (vem para cima das outras)
                _take(t, c); _put(t, c, dest, "battlefield")
                c["x"], c["y"] = _pos(d.get("x")), _pos(d.get("y"))
                if d.get("free"):  # arrastada para fora da carta a que estava presa: solta-se
                    c.pop("at", None)
                return
            _take(t, c)
            if src != "battlefield":
                _clean(c)
                if d.get("down"):
                    c["d"] = True
                if src == "command" and c.get("cm"):  # lançado da zona de comando: o imposto sobe 2
                    c["cc"] = c.get("cc", 0) + 1
            else:  # passa para o lado de outro jogador (controlo trocado): solta-se do que estava preso
                c.pop("at", None)
            _put(t, c, dest, "battlefield")
            c["x"], c["y"] = _pos(d.get("x")), _pos(d.get("y"))
        else:
            if src == to and to != "library":
                return
            _take(t, c)
            if src == "battlefield":
                _leave(t, c)
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
        if host:
            c["at"] = host["id"]
            _log(t, me, "attach", name=None if c.get("d") else c["n"], to=None if host.get("d") else host["n"])
    elif c0 in ("tap", "flip", "face", "attack", "counter", "phase", "attach"):
        c = need()
        if c["z"] != "battlefield":
            raise ValueError("A carta tem de estar no campo.")
        if c0 == "tap":
            c["t"] = not c.get("t") if d.get("on") is None else bool(d["on"])
            if not c["t"]:
                c.pop("atk", None); c.pop("atc", None)
        elif c0 == "flip":
            c["f"] = not c.get("f")
            _log(t, me, "flip", name=None if c.get("d") else c["n"])
        elif c0 == "face":
            if me not in (c["o"], c["s"]):
                raise PermissionError("Só quem controla a carta a pode virar para cima ou para baixo.")
            c["d"] = not c.get("d")
            _log(t, me, "face", name=None if c["d"] else c["n"], down=c["d"])
        elif c0 == "phase":  # phasing: fica na mesa mas não conta
            c["ph"] = not c.get("ph")
            _log(t, me, "phase", name=None if c.get("d") else c["n"], out=c["ph"])
        elif c0 == "attach":  # aura/equipamento/fortificação preso a outra carta do campo (de qualquer lado); to=None solta
            to = d.get("to")
            host = t["cards"].get(str(to)) if to is not None else None
            if to is None:
                c.pop("at", None)
            elif not host or host["z"] != "battlefield" or host["id"] == c["id"] or host.get("at") == c["id"]:
                raise ValueError("Só se prende a outra carta do campo.")
            else:
                c["at"] = host["id"]
                for o in [t["cards"][str(x)] for z in t["zones"] for x in z["battlefield"]]:  # o que estava preso a ela passa para o novo sítio
                    if o.get("at") == c["id"]:
                        o["at"] = host["id"]
                _log(t, me, "attach", name=None if c.get("d") else c["n"], to=None if host.get("d") else host["n"])
        elif c0 == "attack":
            tgt = d.get("seat")
            if tgt is None:
                c.pop("atk", None); c.pop("atc", None)
            else:
                c["atk"], c["t"] = _num(tgt, 0, len(t["seats"]) - 1), True
                # «card»: um planeswalker ou uma batalha desse jogador (no campo dele) em vez do próprio jogador
                pw = t["cards"].get(str(d.get("card"))) if d.get("card") is not None else None
                if pw and pw["z"] == "battlefield" and pw["s"] == c["atk"] and pw["id"] != c["id"]:
                    c["atc"] = pw["id"]
                else:
                    c.pop("atc", None)
                _log(t, me, "attack", name=None if c.get("d") else c["n"], p=c["atk"], to=pw["n"] if c.get("atc") and not pw.get("d") else None)
        else:
            k = str(d.get("k") or "+1/+1").strip()[:16]
            ks = dict(c.get("k") or {})
            ks[k] = _num(ks.get(k, 0) + _num(d.get("d"), -99, 99, 1), -999, 999)
            if not ks[k]:
                del ks[k]
            c["k"] = ks
    elif c0 in ("untapall", "newturn"):  # newturn: desvirar tudo e comprar uma (o começo do teu turno; a solo conta o turno)
        _untap(t, me)
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
        seat.update(life=seat.get("life0", 20), poison=0, energy=0, cd={}, mk=[])
        for c in t["cards"].values():
            c.pop("cc", None)
        t.update(turn=1, gf=20, roll=None, day=None)
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
    elif c0 in ("life", "poison", "energy"):
        who = _num(d.get("seat"), 0, len(t["seats"]) - 1, me)
        s = t["seats"][who]
        s[c0] = _num(s.get(c0, 0) + _num(d.get("d"), -999, 999), -999 if c0 == "life" else 0, 9999)
        for k in _mates(t, who):  # 2HG: a vida e o veneno são da equipa (o parceiro fica igual)
            if c0 in ("life", "poison"):
                t["seats"][k][c0] = s[c0]
        _log(t, me, c0, p=who, d=_num(d.get("d"), -999, 999), v=s[c0])
    elif c0 == "cmdmg":  # dano de comandante: conta por comandante (21 = derrota) e também tira à vida
        who = _num(d.get("seat"), 0, len(t["seats"]) - 1, me)
        name = str(d.get("name") or "").strip()[:150]
        if not any(c.get("cm") and c["n"] == name for c in t["cards"].values()):
            raise ValueError("Esse comandante não está na mesa.")
        s, n = t["seats"][who], _num(d.get("d"), -99, 99)
        cd = s.setdefault("cd", {})
        n = max(n, -cd.get(name, 0))
        cd[name] = cd.get(name, 0) + n
        if not cd[name]:
            del cd[name]
        s["life"] = _num(s["life"] - n, -999, 9999)
        _log(t, me, "cmdmg", p=who, name=name, d=n, v=cd.get(name, 0))
    elif c0 == "mark":  # monarca, iniciativa, bênção da cidade
        k, who = d.get("k"), _num(d.get("seat"), 0, len(t["seats"]) - 1, me)
        if k not in DESIG:
            raise ValueError("Designação desconhecida.")
        mk = t["seats"][who].setdefault("mk", [])
        on = k not in mk
        if on and k != "blessing":
            for s2 in t["seats"]:
                if k in s2.get("mk", []):
                    s2["mk"].remove(k)
        mk.remove(k) if not on else mk.append(k)
        _log(t, me, "mark", p=who, mk=k, on=on)
    elif c0 == "day":  # dia/noite: nenhum -> dia -> noite -> dia…; v=None tira
        v = d.get("v", "night" if t.get("day") == "day" else "day")
        if v not in ("day", "night", None):
            raise ValueError("Dia ou noite?")
        t["day"] = v
        _log(t, me, "day", v=v)
    elif c0 == "tax":  # acertar o imposto de comandante à mão (posto em jogo sem ser lançado…)
        c = need()
        if not c.get("cm"):
            raise ValueError("Só os comandantes têm imposto.")
        c["cc"] = _num(c.get("cc", 0) + _num(d.get("d"), -9, 9), 0, 99)
        if not c["cc"]:
            del c["cc"]
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
    elif c0 == "lookhand":  # olhar para a mão de outro jogador: só quem olha recebe as cartas; o registo diz a todos que olhou
        if d.get("seat") is None:
            seat.pop("look", None)
        else:
            who = _num(d.get("seat"), 0, len(t["seats"]) - 1, me)
            if who == me:
                raise ValueError("Essa mão já é tua.")
            seat["look"] = who
            _log(t, me, "lookhand", p=who, n=len(t["zones"][who]["hand"]))
    elif c0 in ("mill", "exiletop"):  # moer (topo para o cemitério) ou exilar o topo, n cartas
        z, to = t["zones"][me], "graveyard" if c0 == "mill" else "exile"
        n = min(_num(d.get("n"), 1, 20, 1), len(z["library"]))
        for _ in range(n):
            c = t["cards"][str(z["library"][0])]
            _take(t, c); _clean(c); _put(t, c, me, to)
        seat["peek"] = max(0, seat["peek"] - n)
        _log(t, me, c0, n=n)
    elif c0 == "peek":  # s=1: procurar na biblioteca (vê-a toda; ao fechar baralha)
        lib = t["zones"][me]["library"]
        if d.get("s"):
            seat["peek"], seat["srch"] = len(lib), True
            _log(t, me, "search")
        else:
            seat["peek"] = _num(d.get("n"), 0, len(lib))
            if seat["peek"]:
                _log(t, me, "peek", n=seat["peek"])
            elif seat.pop("srch", None):
                RNG.shuffle(lib)
                _log(t, me, "shuffle")
    elif c0 == "pass":
        n = len(t["seats"])
        tm = t.get("teams")
        nxt = next((x % n for x in range(t["active"] + 1, t["active"] + n + 1) if not t["seats"][x % n]["out"]
                    and (not tm or tm[x % n] != tm[t["active"]])), t["active"])  # 2HG: a vez passa à outra equipa
        t["active"], t["turn"] = nxt, t["turn"] + 1
        for s2 in t["seats"]:  # ninguém fica a olhar para a mão de outro de um turno para o outro
            s2.pop("look", None)
        _log(t, me, "pass", p=nxt, turn=t["turn"])
        _turn_start(t, nxt)
        for k in _mates(t, nxt):  # 2HG: o turno é da equipa — o parceiro também desvira e compra
            if not t["seats"][k]["out"]:
                _turn_start(t, k)
    elif c0 == "revealtop":  # o topo da biblioteca: uma vez (fica no registo) ou sempre (always: liga/desliga)
        lib = t["zones"][me]["library"]
        if d.get("always"):
            seat["rt"] = not seat.get("rt")
            _log(t, me, "revealtop", always=seat["rt"], name=t["cards"][str(lib[0])]["n"] if lib and seat["rt"] else None)
        elif lib:
            _log(t, me, "revealtop", name=t["cards"][str(lib[0])]["n"])
    elif c0 == "showlib":  # mostrar a biblioteca toda aos outros (liga/desliga)
        seat["ls"] = not seat.get("ls")
        _log(t, me, "showlib", on=seat["ls"])
    elif c0 == "note":  # uma nota numa carta do campo (todos a veem); vazia apaga
        c = need()
        txt = str(d.get("txt") or "").strip()[:140]
        if txt:
            c["nt"] = txt
        else:
            c.pop("nt", None)
    elif c0 == "block":  # bloquear: esta criatura (do campo) fica a bloquear o atacante; att=None deixa de bloquear
        c = need()
        if c["z"] != "battlefield":
            raise ValueError("Só bloqueia uma carta do campo.")
        if d.get("att") is None:
            c.pop("blk", None)
        else:
            a = t["cards"].get(str(d["att"]))
            if not a or a["z"] != "battlefield" or a.get("atk") is None:
                raise ValueError("Essa carta não está a atacar.")
            c["blk"] = a["id"]
            _log(t, me, "block", name=c["n"], att=a["n"])
    elif c0 == "cast":  # lançar (com alvo ou sem): fica na pilha — no campo de quem lança, marcada sp — até resolver
        c = need()
        if c["z"] == "battlefield" or c["z"] == "library" and not _sees(t, c, me):
            raise ValueError("Essa carta não se lança daí.")
        tg, tgt, tgn = d.get("tg") or {}, None, None
        if tg.get("card") is not None:
            o = t["cards"].get(str(tg["card"]))
            if not o or o["z"] != "battlefield" or o["id"] == c["id"]:
                raise ValueError("O alvo já não está em jogo.")
            tgt, tgn = {"card": o["id"]}, (o["n"] if _public(o) else None)
        elif tg.get("seat") is not None:
            i = _num(tg.get("seat"), 0, len(t["seats"]) - 1)
            tgt, tgn = {"seat": i}, t["seats"][i]["name"]
        src = c["z"]
        _take(t, c); _clean(c)
        if src == "command" and c.get("cm"):
            c["cc"] = c.get("cc", 0) + 1
        _put(t, c, me, "battlefield")
        c["x"], c["y"], c["sp"] = 0.5, 0.5, t["seq"] + 1  # a ordem na pilha
        if tgt:
            c["tg"] = tgt
        _log(t, me, "cast", name=c["n"], tgn=tgn, tgs=tgt.get("seat") if tgt else None)
    elif c0 == "resolve":  # sai da pilha: uma permanente fica no campo (perm=1, onde se diz); o resto vai para o cemitério do dono
        c = need()
        if not c.get("sp"):
            raise ValueError("Esse feitiço já não está na pilha.")
        c.pop("sp", None); c.pop("tg", None)
        _log(t, me, "resolve", name=c["n"])
        if d.get("perm"):
            c["x"], c["y"] = _pos(d.get("x")), _pos(d.get("y"))
        else:
            _take(t, c); _put(t, c, c["o"], "graveyard")
    elif c0 == "step":  # a fase seguinte (ou a escolhida); depois do fim passa a vez
        if not _mine_active(t, me):
            raise ValueError("Só quem tem a vez muda a fase.")
        to = _num(d.get("to"), 0, len(STEPS), t.get("step", 3) + 1) if d.get("to") is not None else t.get("step", 3) + 1
        if to >= len(STEPS):
            return apply(t, me, {"c": "pass"})
        _step(t, to)
    elif c0 == "auto":  # desvirar e comprar sozinho no começo do meu turno
        seat["auto"] = bool(d.get("on"))
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
    elif c0 == "mat":  # o tapete do meu lugar (todos o veem; cada um pode ver só o seu)
        v = d.get("v")
        if v is not None and v not in MATS:
            raise ValueError("Padrão desconhecido.")
        t["seats"][me]["mat"] = v
    elif c0 == "orb":  # a minha esfera da vida (todos a veem)
        v = d.get("v") or {}
        if not isinstance(v, dict) or v.get("t", "auto") not in ORB_T or v.get("a", "auto") not in ORB_A:
            raise ValueError("Esfera desconhecida.")
        t["seats"][me]["orb"] = None if v.get("t", "auto") == "auto" and v.get("a", "auto") == "auto" else {"t": v.get("t", "auto"), "a": v.get("a", "auto")}
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
    elif c0 == "side":  # a lista deste jogo (sideboard): a mesma pilha de cartas, só para lugares meus; vale para o resto da série
        i = _num(d.get("seat"), 0, len(t["seats"]) - 1, me)
        sb = t["sb"].get(str(i))
        if t["seats"][i]["by"] != seat["by"]:
            raise PermissionError("Esse deck não é teu.")
        if not sb:
            raise ValueError("Esse deck não tem sideboard.")
        deck = d.get("deck")
        ok = isinstance(deck, dict) and all(isinstance(deck.get(k) or {}, dict) and all(type(q) is int and 0 < q <= 250 for q in (deck.get(k) or {}).values())
                                            for k in ("main", "side"))
        new = {k: {str(n): q for n, q in (deck.get(k) or {}).items()} for k in ("main", "side")} if ok else None
        if not ok or _pool(new) != _pool(sb["base"]) or sum(new["main"].values()) < min(60, sum(sb["base"]["main"].values())):
            raise ValueError("Essa lista não é o teu deck com o sideboard.")
        t["lists"][str(i)] = {**new, "cm": []}
        sb["ok"] = True
        _log(t, i, "side")  # (sem cartas: o que cada um trocou fica com ele)
        if all(x["ok"] for x in t["sb"].values()):
            _begin(t)
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
            while True:
                if _tick(t):  # o tempo do sideboard acabou: as cartas dão-se agora
                    with db() as con:
                        _save(con, t)
                if t["seq"] > since or time.time() >= end:
                    break
                COND.wait(timeout=max(0.05, min(end, t.get("sideTo") or end) - time.time()))
            return 200, view(t, me)
    if not isinstance(body, dict):
        return 400, {"erro": "Comando inválido."}
    if body.get("c") == "ptr":  # o meu cursor (~8/s, só quando mexe): na mesa toda (x, y) ou num campo (fs, fx, fy) e a zona
        v = body.get("v") or {}
        with COND:
            if not isinstance(v, dict) or v.get("off"):
                (t.get("ptr") or {}).pop(me, None)
            else:
                z = str(v.get("z") or "")
                p = {"x": _frac(v.get("x")), "y": _frac(v.get("y")), "z": z if z in PTR_Z else "", "ts": time.time()}
                if v.get("fs") is not None and v.get("fx") is not None:
                    p.update(fs=_num(v.get("fs"), 0, len(t["seats"]) - 1, 0), fx=_frac(v["fx"]), fy=_frac(v.get("fy")))
                t.setdefault("ptr", {})[me] = p
            t["seq"] += 1
            COND.notify_all()
        return 200, {"ok": True}
    if body.get("c") == "live":  # ao vivo (várias vezes por segundo): só em memória e uma resposta pequena
        v = body.get("v") or {}
        if not isinstance(v, dict) or v.get("k") not in LIVE_K:
            return 400, {"erro": "Comando inválido."}
        with COND:
            live = t.setdefault("live", {})
            if v["k"] == "end":
                live.pop(me, None)
            else:
                live[me] = {"k": v["k"], "x": _frac(v.get("x")), "y": _frac(v.get("y")), "id": _num(v.get("id"), 0, 2 ** 31, 0), "ts": time.time()}
                if v.get("fx") is not None:  # carta por cima do próprio lado: em frações do campo (os outros veem-no em perspetiva)
                    live[me].update(fx=_frac(v["fx"], -0.5, 1.5), fy=_frac(v.get("fy"), -0.5, 1.5))
            t["seq"] += 1
            COND.notify_all()
        return 200, {"ok": True}
    with COND:
        _tick(t)
        try:
            apply(t, me, body)
        except PermissionError as e:
            return 403, {"erro": str(e)}
        except ValueError as e:
            return 400, {"erro": str(e)}
        if t["status"] in ("playing", "ended") and body.get("c") not in ("pen", "chat", "react"):
            _snap(t)  # a réplica: uma fotografia quando a mesa muda
        if t.get("keep") and "result" in t and t.get("snaps") and not t.get("kept") and ON_KEEP:
            try:
                ON_KEEP(t["owner"], _kept(t))
            except Exception as e:  # guardar a réplica não pode parar a mesa
                print("freetable: os meus jogos:", e, flush=True)
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
        # Two-Headed Giant: 4 lugares, vida 30 partilhada, a vez passa à outra equipa e os dois parceiros compram
        gid = create(con, "hubert", "2HG", [{"by": b, "name": b, "deck": deck(b)} for b in ("host", "guest:a", "guest:b", "guest:c")], giant=True)
        gt = T[gid]
        assert [x["life"] for x in gt["seats"]] == [30] * 4 and gt["teams"] == [0, 0, 1, 1] and gt["active"] == 0
        apply(gt, 0, {"c": "life", "seat": 1, "d": -4}); assert [x["life"] for x in gt["seats"]] == [26, 26, 30, 30]
        h2, h3 = len(gt["zones"][2]["hand"]), len(gt["zones"][3]["hand"])
        apply(gt, 1, {"c": "pass"}); assert gt["active"] == 2 and len(gt["zones"][2]["hand"]) == h2 + 1 and len(gt["zones"][3]["hand"]) == h3 + 1
        assert view(gt, 3)["teams"] == [0, 0, 1, 1]
        try:
            create(con, "hubert", "x", [{"by": "host", "name": "H", "deck": deck("H")}] * 2, giant=True)
            raise AssertionError("2HG com 2 lugares")
        except ValueError:
            pass
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
    assert rt["result"] == {"w": 1} and {k: result(rid)[k] for k in ("ended", "w", "turns")} == {"ended": True, "w": 1, "turns": 1}
    with db() as con:
        rid = create(con, "hubert", "R2", [{"by": "host", "name": "H", "deck": deck("A")}, {"by": "host", "name": "H", "deck": deck("B")}])
    rt = T[rid]  # os dois lados do mesmo jogador: escolhe o lugar e desistir do outro dá a vitória
    assert route(db, "GET", f"/api/freetables/{rid}", "hubert", None, "host", 0, 1)[1]["me"] == 1
    route(db, "POST", f"/api/freetables/{rid}", "hubert", {"c": "concede"}, "host", 0, 1)
    assert result(rid)["w"] == 0
    # réplica: cada mudança pelo route deixa uma fotografia (mãos só contadas); igual = não repete
    sn = result(rid)["snaps"]
    assert sn and len(sn[-1]["st"]["seats"]) == 2 and isinstance(sn[-1]["st"]["seats"][0]["hand"], int) and sn[-1]["ev"][2] in ("concede", "result")
    _snap(T[rid])
    assert len(result(rid)["snaps"]) == len(sn) and result(rid)["names"] == ["H", "H"]
    global ON_KEEP
    got, k0 = [], ON_KEEP
    ON_KEEP = lambda o, g: got.append((o, g))  # noqa: E731  — salas (keep=True): no fim vai para «Os meus jogos», uma vez
    with db() as con:
        kid = create(con, "hubert", "K", [{"by": "host", "name": "H", "deck": deck("A")}, {"by": "guest:rui", "name": "Rui", "deck": deck("B")}], keep=True)
    route(db, "POST", f"/api/freetables/{kid}", "hubert", {"c": "life", "d": -3}, "host", 0)
    route(db, "POST", f"/api/freetables/{kid}", "hubert", {"c": "concede"}, "guest:rui", 0)
    route(db, "POST", f"/api/freetables/{kid}", "hubert", {"c": "chat", "t": "gg"}, "host", 0)
    ON_KEEP = k0
    assert len(got) == 1 and got[0][0] == "hubert" and got[0][1]["winner"] == "a" and got[0][1]["me"] == "a" and got[0][1]["ft"] and got[0][1]["snaps"]
    assert not any(x[1].get("keep") for x in [(0, T[rid])])  # as do torneio (sem keep) não se guardam
    # mecânicas: energia, dano de comandante (conta e tira vida), designações únicas, dia/noite, imposto, anexar, phasing
    call("POST", "host", {"c": "energy", "d": 3})
    assert call("GET", "guest:rui")[1]["seats"][0]["energy"] == 3
    boss = t["zones"][1]["command"][0]
    assert call("POST", "guest:rui", {"c": "move", "id": boss, "to": "battlefield", "x": 0.5, "y": 0.5})[0] == 200 and t["cards"][str(boss)]["cc"] == 1
    life0 = t["seats"][0]["life"]
    call("POST", "host", {"c": "cmdmg", "seat": 0, "name": "B Boss", "d": 5})
    assert t["seats"][0]["cd"] == {"B Boss": 5} and t["seats"][0]["life"] == life0 - 5
    assert call("POST", "host", {"c": "cmdmg", "seat": 0, "name": "Ninguém", "d": 1})[0] == 400
    call("POST", "host", {"c": "cmdmg", "seat": 0, "name": "B Boss", "d": -9})
    assert t["seats"][0]["cd"] == {} and t["seats"][0]["life"] == life0
    call("POST", "host", {"c": "mark", "k": "monarch"}); call("POST", "guest:rui", {"c": "mark", "k": "monarch"}); call("POST", "host", {"c": "mark", "k": "blessing"})
    assert t["seats"][0]["mk"] == ["blessing"] and t["seats"][1]["mk"] == ["monarch"]
    call("POST", "host", {"c": "day"}); call("POST", "host", {"c": "day"})
    assert call("GET", "guest:rui")[1]["day"] == "night"
    call("POST", "host", {"c": "mat", "v": "arcano"})  # o tapete do anfitrião, visto pelo convidado
    assert call("GET", "guest:rui")[1]["seats"][0]["mat"] == "arcano" and call("POST", "host", {"c": "mat", "v": "<x>"})[0] == 400
    call("POST", "guest:rui", {"c": "tax", "id": boss, "d": -1})
    assert "cc" not in t["cards"][str(boss)]
    h1 = t["zones"][0]["hand"][0]
    call("POST", "host", {"c": "move", "id": h1, "to": "battlefield", "x": 0.2, "y": 0.2})
    assert call("POST", "host", {"c": "attach", "id": h1, "to": boss})[0] == 200 and call("GET", "guest:rui")[1]["seats"][0]["battlefield"][-1]["at"] == boss
    assert call("POST", "host", {"c": "attach", "id": h1, "to": h1})[0] == 400
    h2 = t["zones"][0]["hand"][0]  # largada da mão em cima de outra carta: entra já presa (um só comando)
    assert call("POST", "host", {"c": "move", "id": h2, "to": "graveyard", "at": boss})[0] == 400 and call("POST", "host", {"c": "move", "id": h2, "to": "battlefield", "at": h2})[0] == 400
    assert t["cards"][str(h2)]["z"] == "hand" and call("POST", "host", {"c": "move", "id": h2, "to": "battlefield", "x": 0.3, "y": 0.3, "at": boss})[0] == 200
    assert t["cards"][str(h2)]["at"] == boss and [e["k"] for e in t["log"][-2:]] == ["move", "attach"]
    call("POST", "guest:rui", {"c": "phase", "id": boss})
    assert t["cards"][str(boss)]["ph"]
    call("POST", "guest:rui", {"c": "move", "id": boss, "to": "command"})
    assert "at" not in t["cards"][str(h1)] and "ph" not in t["cards"][str(boss)]  # o comandante saiu: a aura fica solta
    # revelar o topo (sempre) e mostrar a biblioteca: os outros veem; nota numa carta
    call("POST", "host", {"c": "revealtop", "always": 1})
    rv = call("GET", "guest:rui")[1]["seats"][0]
    assert rv["rt"] and rv["rtop"]["n"] == t["cards"][str(t["zones"][0]["library"][0])]["n"]
    call("POST", "host", {"c": "revealtop", "always": 1}); assert "rtop" not in call("GET", "guest:rui")[1]["seats"][0]
    call("POST", "host", {"c": "showlib"})
    assert len(call("GET", "guest:rui")[1]["seats"][0]["libv"]) == len(t["zones"][0]["library"]) and all(c.get("n") for c in call("GET", "guest:rui")[1]["seats"][0]["libv"])
    assert "libv" not in call("GET", "host")[1]["seats"][0]
    call("POST", "host", {"c": "showlib"}); assert "libv" not in call("GET", "guest:rui")[1]["seats"][0]
    # bloquear um atacante
    z0, z1 = t["zones"][0], t["zones"][1]
    a0, d0 = z0["hand"][1], z1["hand"][1]
    call("POST", "host", {"c": "move", "id": a0, "to": "battlefield"}); call("POST", "guest:rui", {"c": "move", "id": d0, "to": "battlefield"})
    call("POST", "host", {"c": "attack", "id": a0, "seat": 1}); call("POST", "guest:rui", {"c": "block", "id": d0, "att": a0})
    assert t["cards"][str(d0)]["blk"] == a0 and t["log"][-1]["k"] == "block"
    call("POST", "guest:rui", {"c": "block", "id": d0, "att": None}); assert "blk" not in t["cards"][str(d0)]
    call("POST", "host", {"c": "move", "id": a0, "to": "hand"}); call("POST", "guest:rui", {"c": "move", "id": d0, "to": "hand"})
    # a pilha: lançar com alvo, responder (anular) e resolver
    z0, z1 = t["zones"][0], t["zones"][1]
    bolt, cs = z0["hand"][0], z1["hand"][0]
    call("POST", "host", {"c": "cast", "id": bolt, "tg": {"seat": 1}})
    b = t["cards"][str(bolt)]
    assert b["z"] == "battlefield" and b["sp"] and b["tg"] == {"seat": 1} and t["log"][-1]["k"] == "cast"
    assert next(c for c in call("GET", "guest:rui")[1]["seats"][0]["battlefield"] if c["id"] == bolt)["sp"]
    call("POST", "guest:rui", {"c": "cast", "id": cs, "tg": {"card": bolt}})
    assert t["cards"][str(cs)]["tg"] == {"card": bolt}
    call("POST", "guest:rui", {"c": "resolve", "id": cs}); call("POST", "guest:rui", {"c": "move", "id": bolt, "to": "graveyard"})  # anulado
    assert bolt in z0["graveyard"] and cs in z1["graveyard"] and "sp" not in b and "tg" not in b
    assert call("POST", "host", {"c": "resolve", "id": bolt})[0] == 400
    call("POST", "host", {"c": "peek", "s": 1})  # procurar na biblioteca: vê-a toda e ao fechar baralha
    hv0 = call("GET", "host")[1]["seats"][0]
    assert hv0["srch"] and len(hv0["top"]) == len(t["zones"][0]["library"]) and all(c.get("n") for c in hv0["top"])
    assert not any("top" in x for x in call("GET", "guest:rui")[1]["seats"])
    call("POST", "host", {"c": "peek", "n": 0}); assert t["log"][-1]["k"] == "shuffle" and not t["seats"][0].get("srch")
    h1 = len(t["zones"][1]["hand"])
    call("POST", "host", {"c": "pass"})
    assert t["active"] == 1 and t["turn"] == 2
    # fases: quem recebe a vez desvira e compra sozinho e fica na principal; Espaço avança; depois do fim passa a vez
    assert t["step"] == STEPS.index("main1") and len(t["zones"][1]["hand"]) == h1 + 1
    assert call("POST", "host", {"c": "step"})[0] == 400  # não é a vez do anfitrião
    for want in ("combat", "main2", "end"):
        call("POST", "guest:rui", {"c": "step"}); assert STEPS[t["step"]] == want, t["step"]
    call("POST", "guest:rui", {"c": "auto", "on": False}); call("POST", "guest:rui", {"c": "step"})
    assert t["active"] == 0 and t["turn"] == 3 and t["step"] == STEPS.index("main1")
    call("POST", "host", {"c": "step", "to": 6}); call("POST", "host", {"c": "step"})  # a vez do Rui, sem automático: fica no desvirar
    assert t["active"] == 1 and t["step"] == 0
    call("POST", "guest:rui", {"c": "auto", "on": True}); h1 = len(t["zones"][1]["hand"])
    call("POST", "guest:rui", {"c": "step", "to": 2}); assert t["step"] == STEPS.index("main1") and len(t["zones"][1]["hand"]) == h1 + 1
    assert call("POST", "host", {"c": "rm -rf"})[0] == 400 and call("POST", "guest:rui", {"c": "close"})[0] == 403
    consistent()
    # o registo nunca diz o nome de uma carta escondida
    hidden = [e for e in t["log"] if e["k"] == "move" and e["fr"] in ("hand", "library") and e["to"] in ("hand", "library")]
    assert hidden and not any(e["name"] for e in hidden), t["log"]
    # ao vivo: o que um agarra o outro vê (e quem agarra não se vê a si), sem ir para a base de dados
    assert call("POST", "host", {"c": "live", "v": {"k": "orb", "x": 0.3, "y": 0.9, "id": 0}}) == (200, {"ok": True})
    assert call("GET", "guest:rui")[1]["live"]["0"]["k"] == "orb" and not call("GET", "host")[1]["live"]
    call("POST", "host", {"c": "live", "v": {"k": "card", "x": 0.3, "y": 0.9, "id": 5, "fx": 0.4, "fy": 9}})
    assert call("GET", "guest:rui")[1]["live"]["0"] == {"k": "card", "x": 0.3, "y": 0.9, "id": 5, "fx": 0.4, "fy": 1.5}
    with db() as con:
        _save(con, t)
        assert '"live"' not in con.execute("SELECT state FROM freetables WHERE id=?", (tid,)).fetchone()[0]
    call("POST", "host", {"c": "live", "v": {"k": "end"}})
    # o cursor: os outros veem onde ando e em que zona (nunca a carta); não se grava; «off» tira-o
    call("POST", "host", {"c": "ptr", "v": {"x": 0.2, "y": 0.8, "z": "hand", "fs": 0, "fx": 0.5, "fy": 2}})
    pg = call("GET", "guest:rui")[1]["ptr"]["0"]
    assert pg["z"] == "hand" and pg["fy"] <= 1.2 and pg["age"] < 1 and not call("GET", "host")[1]["ptr"], pg
    call("POST", "host", {"c": "ptr", "v": {"x": 0.2, "y": 0.8, "z": "carta-secreta"}}); assert call("GET", "guest:rui")[1]["ptr"]["0"]["z"] == ""
    call("POST", "host", {"c": "ptr", "v": {"off": True}}); assert not call("GET", "guest:rui")[1]["ptr"]
    assert not call("GET", "guest:rui")[1]["live"] and call("POST", "host", {"c": "live", "v": {"k": "x"}})[0] == 400
    # olhar para a mão de outro (Thoughtseize): só quem olha vê os nomes, o terceiro não; tira uma para o cemitério
    with db() as con:
        lid = create(con, "hubert", "L", [{"by": "host", "name": "H", "deck": deck("A")}, {"by": "guest:rui", "name": "Rui", "deck": deck("B")},
                                         {"by": "guest:ana", "name": "Ana", "deck": deck("C")}])
    lt = T[lid]
    lget = lambda who: route(db, "GET", f"/api/freetables/{lid}", "hubert", None, who, 0)[1]  # noqa: E731
    lpost = lambda who, b: route(db, "POST", f"/api/freetables/{lid}", "hubert", b, who, 0)  # noqa: E731
    hn = {lt["cards"][str(x)]["n"] for x in lt["zones"][0]["hand"]}
    h0 = lt["zones"][0]["hand"][0]
    assert lpost("guest:rui", {"c": "move", "id": h0, "to": "graveyard"})[0] == 403  # sem olhar, não
    assert lpost("guest:rui", {"c": "lookhand", "seat": 1})[0] == 400  # a própria mão
    assert lpost("guest:rui", {"c": "lookhand", "seat": 0})[0] == 200
    rv, av, hv = lget("guest:rui"), lget("guest:ana"), lget("host")
    assert all("n" in c for c in rv["seats"][0]["hand"]) and rv["seats"][1]["look"] == 0 and av["seats"][1]["look"] == 0
    assert all("n" not in c for c in rv["seats"][2]["hand"]), "olhar para uma mão não mostra as outras"
    assert not any(n in json.dumps(av) for n in hn) and all("n" not in c for c in hv["seats"][1]["hand"]), "o terceiro viu a mão olhada"
    assert lt["log"][-1]["k"] == "lookhand" and lt["log"][-1]["p"] == 0 and not any(n in json.dumps(lt["log"][-1]) for n in hn)
    for bad in ({"c": "move", "id": h0, "to": "hand"}, {"c": "move", "id": h0, "to": "battlefield"}, {"c": "reveal", "id": h0}):
        assert lpost("guest:rui", bad)[0] == 403, bad
    assert lpost("guest:ana", {"c": "move", "id": h0, "to": "graveyard"})[0] == 403  # quem não olha, não
    nm = lt["cards"][str(h0)]["n"]
    assert lpost("guest:rui", {"c": "move", "id": h0, "to": "graveyard"})[0] == 200
    assert lt["zones"][0]["graveyard"] == [h0] and lt["log"][-1]["name"] == nm and lt["log"][-1]["w"] == 0  # descartada: pública
    h1 = lt["zones"][0]["hand"][0]
    assert lpost("guest:rui", {"c": "move", "id": h1, "to": "library", "bottom": True})[0] == 200 and lt["zones"][0]["library"][-1] != h1  # Vendilion Clique: fundo (id novo)
    assert lt["log"][-1]["name"] is None  # para a biblioteca: sem nome
    lpost("guest:rui", {"c": "lookhand", "seat": None})
    assert all("n" not in c for c in lget("guest:rui")["seats"][0]["hand"]) and "look" not in lget("guest:ana")["seats"][1]
    lpost("guest:ana", {"c": "lookhand", "seat": 1}); lpost("guest:ana", {"c": "pass"})
    assert all("look" not in s2 for s2 in lt["seats"])  # passar a vez fecha os olhares
    # sideboard entre jogos de uma série: as cartas só se dão quando todos estão prontos; a lista de cada um só a vê ele
    sdeck = lambda n: {**deck(n), "side": {f"{n} Side {i}": 2 for i in range(3)}}  # noqa: E731
    seats3 = [{"by": "host", "name": "H", "deck": sdeck("A")}, {"by": "guest:rui", "name": "Rui", "deck": sdeck("B")},
              {"by": "guest:ana", "name": "Ana", "deck": deck("C")}]
    with db() as con:
        g1 = create(con, "hubert", "S1", seats3)  # jogo 1: sem sideboard
        g2 = create(con, "hubert", "S2", seats3, side=2, prev=g1)
    s1, s2 = T[g1], T[g2]
    assert s1["status"] == "playing" and s1["next"] == g2 and s2["status"] == "side" and not s2["cards"] and set(s2["sb"]) == {"0", "1"}
    sget = lambda who, tid=g2: route(db, "GET", f"/api/freetables/{tid}", "hubert", None, who, 0)[1]  # noqa: E731
    spost = lambda who, b: route(db, "POST", f"/api/freetables/{g2}", "hubert", b, who, 0)  # noqa: E731
    assert sget("guest:rui", g1)["next"] == g2
    hv, rv, av = sget("host"), sget("guest:rui"), sget("guest:ana")
    assert set(hv["side"]["mine"]) == {"0"} and set(rv["side"]["mine"]) == {"1"} and av["side"]["mine"] == {} and av["side"]["ok"] == {"0": False, "1": False}
    assert hv["side"]["g"] == 2 and 170 <= hv["side"]["to"] <= 180 and hv["side"]["mine"]["0"]["deck"] == hv["side"]["mine"]["0"]["base"] == {"main": deck("A")["main"], "side": sdeck("A")["side"]}
    assert not any(x in json.dumps(rv) + json.dumps(av) for x in ("A Card", "A Side")), "outro lugar viu a lista do anfitrião"
    assert not any(x in json.dumps(hv) + json.dumps(av) for x in ("B Card", "B Side")), "outro lugar viu a lista do convidado"
    assert spost("host", {"c": "draw", "n": 1})[0] == 400 and spost("guest:rui", {"c": "side", "seat": 0, "deck": hv["side"]["mine"]["0"]["deck"]})[0] == 403
    assert spost("guest:rui", {"c": "chat", "text": "gg"})[0] == 200 and spost("host", {"c": "react", "i": s2["log"][-1]["id"], "e": REACT[0]})[0] == 200  # a conversa continua
    assert spost("guest:ana", {"c": "side", "seat": 2, "deck": {"main": {}, "side": {}}})[0] == 400  # sem sideboard
    good = {"main": {**deck("A")["main"], "A Card 0": 2, "A Side 0": 2}, "side": {"A Card 0": 2, "A Side 1": 2, "A Side 2": 2}}  # 2 saem, 2 entram
    for bad in ({"main": {**good["main"], "Black Lotus": 1}, "side": good["side"]}, {"main": {"A Card 0": 2}, "side": {}}, {"main": {**good["main"], "A Card 1": 4.0}, "side": good["side"]}, "x",
                {"main": {**good["main"], "A Card 1": 2}, "side": {**good["side"], "A Card 1": 2}}):  # outra pilha, poucas cartas, cópias não inteiras
        assert spost("host", {"c": "side", "deck": bad})[0] == 400, bad
    assert spost("host", {"c": "side", "deck": good})[0] == 200 and s2["status"] == "side"
    assert sget("guest:rui")["side"]["ok"] == {"0": True, "1": False} and s2["log"][-1] == {**s2["log"][-1], "k": "side", "s": 0}
    assert not any(x in json.dumps(sget("guest:rui")) for x in ("A Card", "A Side")) and spost("host", {"c": "side", "deck": good})[0] == 200  # pode mudar enquanto espera
    assert spost("guest:rui", {"c": "side", "deck": rv["side"]["mine"]["1"]["deck"]})[0] == 200 and s2["status"] == "playing"  # «Manter o deck»
    names0 = [s2["cards"][str(c)]["n"] for z in ("library", "hand") for c in s2["zones"][0][z]]
    assert len(names0) == 60 and names0.count("A Side 0") == 2 and names0.count("A Card 0") == 2 and "side" not in sget("host")
    assert len(s2["zones"][2]["hand"]) == 7 and spost("host", {"c": "side", "deck": good})[0] == 400  # já fechou
    with db() as con:  # jogo 3: a lista escolhida continua (a guardada é a base); o tempo acaba e joga com ela
        g3 = create(con, "hubert", "S3", seats3, side=3, prev=g2)
    s3 = T[g3]
    m3 = route(db, "GET", f"/api/freetables/{g3}", "hubert", None, "host", 0)[1]["side"]["mine"]["0"]
    assert m3["deck"] == good and m3["base"]["main"] == deck("A")["main"] and T[g2]["next"] == g3
    s3["sideTo"] = time.time() - 1
    assert route(db, "GET", f"/api/freetables/{g3}", "hubert", None, "guest:ana", 0)[1]["status"] == "playing" and s3["log"][-2]["k"] == "sidetime"
    assert [s3["cards"][str(c)]["n"] for z in ("library", "hand") for c in s3["zones"][0][z]].count("A Side 0") == 2
    with db() as con:  # o deck guardado mudou entretanto (outra pilha): volta à guardada
        g4 = create(con, "hubert", "S4", [{**seats3[0], "deck": {**sdeck("A"), "side": {"A Side 0": 6}}}] + seats3[1:], side=4, prev=g3)
    assert route(db, "GET", f"/api/freetables/{g4}", "hubert", None, "host", 0)[1]["side"]["mine"]["0"]["deck"]["side"] == {"A Side 0": 6}
    with db() as con:  # a mesa perdeu-se e reabre sem a anterior: as listas guardadas à parte (lists) continuam a escolha
        assert lists(con, g2)["0"]["main"] == good["main"] and lists(con, "nada") is None
        g5 = create(con, "hubert", "S5", seats3, side=3, prev="nada", was=lists(con, g2))
    assert route(db, "GET", f"/api/freetables/{g5}", "hubert", None, "host", 0)[1]["side"]["mine"]["0"]["deck"] == good
    print("selfcheck mesa livre ok")


if __name__ == "__main__":
    selfcheck()
