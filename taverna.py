"""Taverna: o sítio dos amigos, no Grimório de quem a cria (como as salas, rooms.py).

Quem aloja abre a Taverna (uma por dono/perfil) e manda o link (/taverna/<link>). Quem o abre fica membro: um amigo
convidado (guests.py) — no browser, com um nome; ou a partir da app Grimório dele (outro servidor), que fala com estas
rotas com «Authorization: Bearer <convite>» (guests.BEARER) e mantém os decks de lá.

Na Taverna há: os membros e quem está ligado agora (batimentos em memória; o «visto há…» fica na base de dados), a
conversa (menções de pessoas @nome e de decks da prateleira, reações, respostas, mensagens fixadas e propostas de
jogo), a Prateleira (cópias dos decks que cada um partilha: os outros veem, copiam para os seus decks e atiram as
caixas na mesa 3D — o canal ao vivo é o das salas, rooms.live_step) e o Hall da Fama: os resultados das mesas e
torneios das salas de quem aloja jogados entre membros (lidos sozinhos de rooms/freetable/playnet/tournaments) e os
que os membros registam à mão (jogos ao vivo, em papel).

Fronteira: um convidado só chega aqui como «guest:<id>» e só faz ações de membro; as de quem aloja (convidar, tirar,
mudar o nome, apagar resultados de outros) respondem 403. Texto limpo de caracteres de controlo e com limites;
publicar tem limite por minuto (guests.slow).
"""
import json, re, secrets, time, urllib.parse

import guests
import rooms

PATH = re.compile(r"^/api/taverna(?:/([a-z]{2,10})(?:/([a-f0-9]{12}))?)?$")
REACT = ("👍", "😂", "🔥", "😮", "🎉", "✋")  # ✋ numa proposta de jogo = «eu alinho»
CTRL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f​-‏‪-‮⁦-⁩]")  # controlo e marcas de direção (texto que se vira ao contrário)
MSG_MAX, NAME_MAX, MOTTO_MAX = 600, 40, 120
SHELF_PER, SHELF_ALL, KEEP_MSGS = 12, 80, 2000
ONLINE_S = 40          # segundos sem batimento até contar como desligado
PTS = {"w": 3, "d": 1, 1: 8, 2: 5, 3: 3}  # pontos do Hall da Fama: vitória, empate, 1.º/2.º/3.º num torneio
PRES = {}              # (dono, quem) -> {"t": último batimento, "p": a jogar, "s": última vez gravado na base}
_REC = {}              # dono -> última vez que se leram as salas (resultados e anúncios), no máximo de 8 em 8 s
SALA = re.compile(r" \((?:sala|taverna)\)$")
CLOSED_LINK = "Quem aloja fechou esta Taverna: o link já não deixa entrar."  # = guests.TXT tv_closed
CLOSED = "Esta Taverna está fechada: só dá para ler."
ROOMS_PER, ROOMS_ALL = 2, 8  # mesas abertas por membro (que ainda não começaram) e no total abertas por membros
READ_ONLY = ("ping", "read", "leave", "reopen", "delete")  # o que ainda se faz com a Taverna fechada


def _open_rooms(con, owner, who=None):
    """Quem abriu cada mesa aberta (ainda por começar) por um membro -> [quem], ou só quantas são de `who`."""
    rooms.init(con)
    by = [w for (w,) in con.execute("SELECT json_extract(spec, '$.by') FROM rooms WHERE owner=? AND status='open' AND json_extract(spec, '$.by') IS NOT NULL", (owner,))]
    return by.count(who) if who else by


def room_ok(con, owner, who):
    """Um membro (não quem aloja) pode abrir uma mesa nas salas de quem aloja? -> None ou (código, erro).
    Só membros de uma Taverna aberta, no máximo ROOMS_PER mesas abertas suas (ROOMS_ALL de todos os membros) e 4 por minuto."""
    init(con)
    t = row(con, owner)
    if not t or not is_member(con, owner, who):
        return 403, "Só os membros da Taverna abrem mesas."
    if t["closed"]:
        return 409, CLOSED
    by = _open_rooms(con, owner)
    if by.count(who) >= ROOMS_PER:
        return 409, "Já tens 2 mesas abertas: cancela uma primeiro."  # ROOMS_PER (o texto fixo traduz-se na app)
    if len(by) >= ROOMS_ALL:
        return 409, "Há mesas abertas demais neste Grimório: espera que alguma comece."
    if guests.slow(("taverna-room", owner, who), 4):
        return 429, "Demasiadas mesas seguidas: espera um minuto."
    return None


def init(con):
    con.execute("CREATE TABLE IF NOT EXISTS taverna (owner TEXT PRIMARY KEY, name TEXT, motto TEXT, link TEXT UNIQUE, created REAL,"
                " rev INTEGER DEFAULT 0, srev INTEGER DEFAULT 0, frev INTEGER DEFAULT 0)")
    con.execute("CREATE TABLE IF NOT EXISTS taverna_members (owner TEXT, who TEXT, joined REAL, removed REAL, seen REAL,"
                " readid INTEGER DEFAULT 0, PRIMARY KEY (owner, who))")
    con.execute("CREATE TABLE IF NOT EXISTS taverna_msgs (id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT, ts REAL, who TEXT, kind TEXT,"
                " m TEXT, x TEXT, react TEXT, pin INTEGER DEFAULT 0, deleted REAL, rev INTEGER)")
    con.execute("CREATE INDEX IF NOT EXISTS taverna_msgs_rev ON taverna_msgs (owner, rev)")
    con.execute("CREATE TABLE IF NOT EXISTS taverna_shelf (id TEXT PRIMARY KEY, owner TEXT, who TEXT, ts REAL, deck TEXT, took INTEGER DEFAULT 0, removed REAL)")
    con.execute("CREATE TABLE IF NOT EXISTS taverna_results (id TEXT PRIMARY KEY, owner TEXT, ts REAL, kind TEXT, src TEXT, name TEXT,"
                " players TEXT, win TEXT, podium TEXT, by TEXT, removed REAL)")
    con.execute("CREATE UNIQUE INDEX IF NOT EXISTS taverna_results_src ON taverna_results (owner, src)")
    if "closed" not in {c[1] for c in con.execute("PRAGMA table_info(taverna)")}:  # fechada por quem aloja: só de leitura
        con.execute("ALTER TABLE taverna ADD COLUMN closed REAL")


def clean(s, n):
    """Texto de fora: sem controlo nem marcas de direção, espaços nas pontas fora, no máximo n caracteres e 3 linhas em branco."""
    s = CTRL.sub("", str(s or "").replace("\r\n", "\n")).strip()
    return re.sub(r"\n{3,}", "\n\n", s)[:n]


def row(con, owner):
    r = con.execute("SELECT name, motto, link, created, rev, srev, frev, closed FROM taverna WHERE owner=?", (owner,)).fetchone()
    return r and dict(zip(("name", "motto", "link", "created", "rev", "srev", "frev", "closed"), r))


def bump(con, owner, k="rev"):
    con.execute(f"UPDATE taverna SET {k}={k}+1 WHERE owner=?", (owner,))  # noqa: S608 — k é uma de três colunas fixas
    return con.execute(f"SELECT {k} FROM taverna WHERE owner=?", (owner,)).fetchone()[0]  # noqa: S608


def names(con, owner):
    """{quem: nome} de todos os que alguma vez foram membros (quem aloja incluído); sem o «(sala)» dos convites de salas."""
    out = {"host": rooms.host_name(con, owner)}
    for who, n in con.execute("SELECT m.who, f.name FROM taverna_members m JOIN friends f ON 'guest:' || f.id = m.who WHERE m.owner=?", (owner,)):
        out[who] = SALA.sub("", n or "?")
    return out


def members(con, owner):
    """Os membros de agora: quem aloja e os amigos que não saíram nem tiveram o convite revogado."""
    guests.init(con)
    rows = con.execute("SELECT m.who, f.name, m.joined, m.seen FROM taverna_members m JOIN friends f ON 'guest:' || f.id = m.who"
                       " WHERE m.owner=? AND m.removed IS NULL AND f.revoked IS NULL ORDER BY m.joined", (owner,)).fetchall()
    t = row(con, owner)
    hs = con.execute("SELECT seen FROM taverna_members WHERE owner=? AND who='host'", (owner,)).fetchone()
    return [{"who": "host", "name": rooms.host_name(con, owner), "host": True, "joined": t and t["created"], "seen": hs and hs[0]}] + \
        [{"who": w, "name": SALA.sub("", n or "?"), "host": False, "joined": j, "seen": s} for w, n, j, s in rows]


def is_member(con, owner, who):
    if who == "host":
        return True
    fid = who[6:] if who.startswith("guest:") else ""
    return bool(con.execute("SELECT 1 FROM taverna_members m JOIN friends f ON f.id=? WHERE m.owner=? AND m.who=? AND m.removed IS NULL AND f.revoked IS NULL AND f.owner=?",
                            (fid, owner, who, owner)).fetchone())


def add_member(con, owner, who):
    """Entra (ou volta, se tinha saído por si) na Taverna. Quem foi tirado por quem aloja só volta se quem aloja o puser."""
    t = row(con, owner)
    if not t or t["closed"]:
        raise PermissionError(CLOSED_LINK)
    r = con.execute("SELECT removed FROM taverna_members WHERE owner=? AND who=?", (owner, who)).fetchone()
    if r and r[0] and r[0] < 0:
        raise PermissionError("Quem aloja tirou-te desta Taverna.")
    if r and not r[0]:
        return False
    con.execute("INSERT OR REPLACE INTO taverna_members (owner, who, joined, removed, seen, readid) VALUES (?,?,?,NULL,?,0)", (owner, who, time.time(), time.time()))
    sys_msg(con, owner, "join", who)
    return True


def sys_msg(con, owner, kind, who, **x):
    rev = bump(con, owner)
    con.execute("INSERT INTO taverna_msgs (owner, ts, who, kind, m, x, react, rev) VALUES (?,?,?,?,?,?,?,?)",
                (owner, time.time(), who, kind, "", json.dumps(x, ensure_ascii=False), "{}", rev))


# ---------- presença ----------

def touch(con, owner, who, playing=None):
    now = time.time()
    p = PRES.setdefault((owner, who), {"t": 0, "p": False, "s": 0})
    p["t"] = now
    if playing is not None:
        p["p"] = bool(playing)
    if now - p["s"] > 60:  # o «visto há…» na base de dados, no máximo uma escrita por minuto
        p["s"] = now
        con.execute("UPDATE taverna_members SET seen=? WHERE owner=? AND who=?", (now, owner, who))
        if who == "host" and not con.execute("SELECT 1 FROM taverna_members WHERE owner=? AND who='host'", (owner,)).fetchone():
            con.execute("INSERT INTO taverna_members (owner, who, joined, seen) VALUES (?,?,?,?)", (owner, "host", now, now))


def presence(owner, who):
    p = PRES.get((owner, who))
    on = bool(p) and time.time() - p["t"] < ONLINE_S
    return {"online": on, "playing": on and p["p"]}


# ---------- mensagens ----------

def view_msg(r, nm, me):
    i, ts, who, kind, m, x, react, pin, deleted = r
    x = json.loads(x or "{}")
    out = {"id": i, "ts": ts, "who": who, "name": nm.get(who) or x.get("n") or "?", "kind": kind}
    if deleted:
        return {**out, "deleted": True}
    react = json.loads(react or "{}")
    out.update(m=m, react={e: v for e, v in react.items() if v}, pin=bool(pin), mine=who == me)
    for k in ("decks", "at", "re", "call", "room", "rn", "rt", "strict", "res", "sum", "deck", "dn"):
        if x.get(k) is not None:
            out[k] = x[k]
    if out.get("at"):
        out["atn"] = [nm.get(w) or "?" for w in out["at"]]
    return out


MSG_COLS = "id, ts, who, kind, m, x, react, pin, deleted"


def mentions(text, mem, me):
    """@nome no texto -> [quem]: os nomes mais compridos primeiro (o «@Ana Rita» não conta também para a «Ana»)."""
    low, out = text.lower(), []
    for w, n in sorted(((x["who"], x["name"]) for x in mem), key=lambda t: -len(t[1])):
        k = "@" + n.lower()
        at = low.find(k)
        if n and at >= 0 and w != me and w not in out:
            out.append(w)
            low = low[:at] + " " * len(k) + low[at + len(k):]
    return out[:10]


def say(con, owner, who, b):
    m = clean(b.get("m"), MSG_MAX)
    shelf = {i for (i,) in con.execute("SELECT id FROM taverna_shelf WHERE owner=? AND removed IS NULL", (owner,))}
    decks = [str(d) for d in (b.get("decks") or [])[:3] if str(d) in shelf] if isinstance(b.get("decks"), list) else []
    call = b.get("call") if isinstance(b.get("call"), dict) else None
    if call:
        call = {"kind": call.get("kind") if call.get("kind") in ("livre", "estrita", "torneio") else "livre", "fmt": clean(call.get("fmt"), 30) or None}
    if not m and not decks and not call:
        return 400, {"erro": "Mensagem vazia."}
    if guests.slow(("taverna-say", owner, who), 20):
        return 429, {"erro": "Calma: muitas mensagens seguidas. Espera um minuto."}
    x = {"n": names(con, owner).get(who)}
    if decks:
        x["decks"] = list(dict.fromkeys(decks))
    if call:
        x["call"] = call
    re_ = b.get("re")
    if isinstance(re_, int):
        q = con.execute("SELECT id, who, m FROM taverna_msgs WHERE owner=? AND id=? AND deleted IS NULL", (owner, re_)).fetchone()
        if q:
            x["re"] = {"id": q[0], "who": q[1], "name": names(con, owner).get(q[1]) or "?", "m": (q[2] or "")[:90]}
    at = mentions(m, members(con, owner), who)
    if at:
        x["at"] = at
    rev = bump(con, owner)
    cur = con.execute("INSERT INTO taverna_msgs (owner, ts, who, kind, m, x, react, rev) VALUES (?,?,?,?,?,?,?,?)",
                      (owner, time.time(), who, "call" if call else "msg", m, json.dumps(x, ensure_ascii=False), "{}", rev))
    mid = cur.lastrowid
    con.execute("UPDATE taverna_members SET readid=max(readid, ?) WHERE owner=? AND who=?", (mid, owner, who))
    old = con.execute("SELECT id FROM taverna_msgs WHERE owner=? AND pin=0 ORDER BY id DESC LIMIT 1 OFFSET ?", (owner, KEEP_MSGS)).fetchone()
    if old:  # ponytail: as mais antigas saem (as fixadas ficam); um arquivo só se alguém pedir
        con.execute("DELETE FROM taverna_msgs WHERE owner=? AND pin=0 AND id<=?", (owner, old[0]))
    return 201, {"id": mid}


def msg_edit(con, owner, who, act, b):
    mid = b.get("id")
    r = con.execute("SELECT who, react, pin FROM taverna_msgs WHERE owner=? AND id=? AND deleted IS NULL", (owner, mid if isinstance(mid, int) else -1)).fetchone()
    if not r:
        return 404, {"erro": "Essa mensagem já não existe."}
    if act == "react":
        e = b.get("e")
        if e not in REACT:
            return 400, {"erro": "Reação desconhecida."}
        if guests.slow(("taverna-react", owner, who), 60):
            return 429, {"erro": "Demasiadas reações seguidas."}
        rc = json.loads(r[1] or "{}")
        lst = [w for w in rc.get(e, []) if w != who]
        rc[e] = lst if who in rc.get(e, []) else lst + [who]
        con.execute("UPDATE taverna_msgs SET react=?, rev=? WHERE id=?", (json.dumps(rc), bump(con, owner), mid))
    elif act == "pin":
        if who != "host" and r[0] != who:
            return 403, {"erro": "Só quem escreveu ou quem aloja fixa esta mensagem."}
        if b.get("on", True) and con.execute("SELECT COUNT(*) FROM taverna_msgs WHERE owner=? AND pin=1 AND deleted IS NULL", (owner,)).fetchone()[0] >= 10:
            return 409, {"erro": "Já há 10 mensagens fixadas: desafixa uma primeiro."}
        con.execute("UPDATE taverna_msgs SET pin=?, rev=? WHERE id=?", (1 if b.get("on", True) else 0, bump(con, owner), mid))
    elif act == "del":
        if who != "host" and r[0] != who:
            return 403, {"erro": "Só quem escreveu ou quem aloja apaga esta mensagem."}
        con.execute("UPDATE taverna_msgs SET deleted=?, pin=0, m='', rev=? WHERE id=?", (time.time(), bump(con, owner), mid))
    return 200, {"ok": True}


# ---------- prateleira ----------

def shelf(con, owner, nm, full=True):
    out = []
    for i, who, ts, deck, took in con.execute("SELECT id, who, ts, deck, took FROM taverna_shelf WHERE owner=? AND removed IS NULL ORDER BY ts DESC", (owner,)):
        d = json.loads(deck)
        out.append({"id": i, "who": who, "by": nm.get(who) or "?", "ts": ts, "took": took, "name": d.get("name"), "format": d.get("format"),
                    "commanders": d.get("commanders") or [], "cover": d.get("cover"), "n": sum(d.get("main", {}).values()) + len(d.get("commanders") or []),
                    **({"main": d.get("main"), "side": d.get("side")} if full else {})})
    return out


def share_deck(con, owner, who, b):
    d = guests.clean_deck(b.get("deck"))
    if not d:
        return 400, {"erro": "Esse deck está vazio."}
    d.pop("src_id", None)
    if guests.slow(("taverna-share", owner, who), 10):
        return 429, {"erro": "Demasiados decks seguidos: espera um minuto."}
    mine = con.execute("SELECT id, deck FROM taverna_shelf WHERE owner=? AND who=? AND removed IS NULL", (owner, who)).fetchall()
    same = next((i for i, x in mine if json.loads(x).get("name") == d["name"]), None)
    now = time.time()
    if same:  # o mesmo deck (pelo nome) atualiza-se em vez de ficar duas vezes
        con.execute("UPDATE taverna_shelf SET deck=?, ts=? WHERE id=?", (json.dumps(d, ensure_ascii=False), now, same))
        bump(con, owner, "srev")
        return 200, {"id": same, "updated": True}
    if len(mine) >= SHELF_PER:
        return 409, {"erro": "Já tens 12 decks na prateleira: tira um primeiro."}  # SHELF_PER (o texto fixo traduz-se na app)
    if con.execute("SELECT COUNT(*) FROM taverna_shelf WHERE owner=? AND removed IS NULL", (owner,)).fetchone()[0] >= SHELF_ALL:
        return 409, {"erro": "A prateleira está cheia."}
    sid = secrets.token_hex(6)
    con.execute("INSERT INTO taverna_shelf (id, owner, who, ts, deck) VALUES (?,?,?,?,?)", (sid, owner, who, now, json.dumps(d, ensure_ascii=False)))
    bump(con, owner, "srev")
    if b.get("say", True):
        sys_msg(con, owner, "shelf", who, deck=sid, dn=d["name"])
    return 201, {"id": sid}


# ---------- resultados (Hall da Fama) ----------

def _who_of_deck(con, owner, p):
    """De quem é um lugar de torneio: o «by» das salas; senão o dono do deck guardado (um amigo ou quem aloja); meta: ninguém."""
    if p.get("by"):
        return p["by"]
    if p.get("src") != "meus":
        return None
    r = con.execute("SELECT json_extract(body, '$.friend'), json_extract(body, '$.community') FROM decks WHERE id=? AND owner=?", (str(p.get("ref")), owner)).fetchone()
    if not r or r[1]:
        return None
    return f"guest:{r[0]}" if r[0] else "host"


def _room_result(con, owner, rid, spec, players, tid, nm):
    """O resultado de uma sala começada, se já houver: (kind, name, players, win, podium) | 'void' (já não se sabe) | None (ainda não)."""
    import freetable, playnet
    name = spec.get("name") or "Mesa"
    if spec.get("type") == "livre":
        if str(tid).startswith("fp:"):
            r = playnet.result(str(tid)[3:])
            if not r:
                return "void"
            if not r["ended"]:
                return None
            n = len(players)
            first = 0 if spec.get("giant") else int(spec.get("first") or 0) % max(1, n)
            pl = [{"who": p.get("by") or "host", "name": p.get("byName") or nm.get("host"), "deck": p.get("name")} for p in players]
            j = "abcd".find(r.get("side") or "")
            if j < 0:
                return "estrita", name, pl, [], None
            k = (first + j) % n
            win = [pl[i]["who"] for i in ((0, 1) if k < 2 else (2, 3))] if spec.get("giant") and n == 4 else [pl[k]["who"]]
            return "estrita", name, pl, win, None
        t = freetable._find(con, tid)
        if not t:
            return "void"
        if "result" not in t:
            return None
        pl = [{"who": s["by"], "name": s.get("name"), "deck": s.get("deck")} for s in t["seats"]]
        w = t["result"].get("w")
        if w is None:
            return "mesa", name, pl, [], None
        if t.get("teams"):
            team = t["teams"][w]
            win = [pl[i]["who"] for i, tm in enumerate(t["teams"]) if tm == team]
        else:
            win = [pl[w]["who"]]
        return "mesa", name, pl, win, None
    r = con.execute("SELECT status, state FROM tournaments WHERE id=? AND owner=?", (tid, owner)).fetchone()
    if not r or r[0] in ("cancelled", "deleted"):
        return "void"
    if r[0] != "done":
        return None
    import tournament
    st = json.loads(r[1])
    who_i = [_who_of_deck(con, owner, p) for p in st.get("players") or []]
    pl = [{"who": w, "name": nm.get(w) or p.get("fr") or "?", "deck": p.get("name")} for w, p in zip(who_i, st.get("players") or []) if w]
    pod = [{"who": who_i[x["i"]], "name": nm.get(who_i[x["i"]]) or x.get("fr") or "?", "deck": x.get("name"), "place": x["place"]}
           for x in tournament.podium(st) if who_i[x["i"]]]
    return "torneio", st.get("name") or name, pl, [x["who"] for x in pod if x["place"] == 1], pod


def reconcile(con, owner, force=False):
    """Lê as salas de quem aloja: anuncia as novas na conversa e guarda os resultados das que acabaram entre membros."""
    now = time.time()
    if not force and now - _REC.get(owner, 0) < 8:
        return
    _REC[owner] = now
    t = row(con, owner)
    if not t or t["closed"]:  # fechada: nada de novo (nem anúncios nem resultados)
        return
    rooms.init(con)
    mem = {m["who"] for m in members(con, owner)}
    nm = names(con, owner)
    done = {s for (s,) in con.execute("SELECT src FROM taverna_results WHERE owner=?", (owner,))}
    said = {r for (r,) in con.execute("SELECT json_extract(x, '$.room') FROM taverna_msgs WHERE owner=? AND kind='room'", (owner,))}
    for rid, ts, spec, players, status, tid in con.execute(
            "SELECT id, ts, spec, players, status, tid FROM rooms WHERE owner=? AND ts>=? AND ts>? AND status IN ('open', 'started') ORDER BY ts",
            (owner, t["created"] - 1, now - 7 * 86400)).fetchall():
        spec, players = json.loads(spec), json.loads(players)
        if rid not in said and now - ts < 86400:
            opener = spec.get("by") if spec.get("by") in mem else "host"  # a mesa de um membro: anuncia-se em nome dele
            sys_msg(con, owner, "room", opener, room=rid, rn=str(spec.get("name") or "")[:80], rt=spec.get("type"), strict=bool(spec.get("strict")))
            said.add(rid)
        src = f"room:{rid}"
        if status != "started" or not tid or src in done:
            continue
        try:
            got = _room_result(con, owner, rid, spec, players, tid, nm)
        except Exception as e:  # um resultado estranho não pode parar a Taverna
            print("taverna: resultado da sala", rid, e, flush=True)
            got = "void" if now - ts > 2 * 86400 else None
        if got is None:
            continue
        if got == "void":
            if now - ts > 2 * 86400:  # já não se vai saber (servidor reiniciado a meio): deixa de se perguntar
                con.execute("INSERT OR IGNORE INTO taverna_results (id, owner, ts, kind, src, removed) VALUES (?,?,?,?,?,?)", (secrets.token_hex(6), owner, now, "void", src, now))
            continue
        kind, name, pl, win, pod = got
        if len({p["who"] for p in pl if p["who"] in mem}) < 2:  # só conta entre membros (quem aloja e pelo menos outro)
            con.execute("INSERT OR IGNORE INTO taverna_results (id, owner, ts, kind, src, removed) VALUES (?,?,?,?,?,?)", (secrets.token_hex(6), owner, now, "void", src, now))
            continue
        res = secrets.token_hex(6)
        con.execute("INSERT OR IGNORE INTO taverna_results (id, owner, ts, kind, src, name, players, win, podium, by) VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (res, owner, now, kind, src, str(name)[:80], json.dumps(pl, ensure_ascii=False), json.dumps(win), json.dumps(pod, ensure_ascii=False) if pod else None, None))
        bump(con, owner, "frev")
        sys_msg(con, owner, "res", "host", res=res, sum=summary(kind, name, pl, win, pod))


def summary(kind, name, pl, win, pod):
    """O resumo de um resultado para a conversa (nomes de agora: a mensagem não muda se alguém mudar de nome)."""
    nm = {p["who"]: p["name"] for p in pl}
    return {"k": kind, "n": clean(name, 80) or None, "p": [p["name"] for p in pl][:8], "w": [nm.get(w) or "?" for w in win][:2],
            **({"pod": [[x["place"], x["name"]] for x in pod][:4]} if pod else {})}


def add_result(con, owner, who, b):
    """Um resultado registado à mão (um jogo em papel, noutro sítio): 2–4 membros, quem ganhou (ou empate); quem regista joga."""
    mem = {m["who"]: m["name"] for m in members(con, owner)}
    ps = [p for p in dict.fromkeys(b.get("players") or []) if p in mem] if isinstance(b.get("players"), list) else []
    if not 2 <= len(ps) <= 4:
        return 400, {"erro": "Escolhe entre 2 e 4 membros que jogaram."}
    if who != "host" and who not in ps:
        return 403, {"erro": "Só registas jogos em que jogaste."}
    win = b.get("win")
    if win is not None and win not in ps:
        return 400, {"erro": "Quem ganhou?"}
    if guests.slow(("taverna-res", owner, who), 10):
        return 429, {"erro": "Demasiados resultados seguidos: espera um minuto."}
    decks = b.get("decks") if isinstance(b.get("decks"), dict) else {}
    pl = [{"who": p, "name": mem[p], "deck": clean(decks.get(p), 80) or None} for p in ps]
    res = secrets.token_hex(6)
    con.execute("INSERT INTO taverna_results (id, owner, ts, kind, src, name, players, win, by) VALUES (?,?,?,?,?,?,?,?,?)",
                (res, owner, time.time(), "manual", f"manual:{res}", clean(b.get("name"), 80) or None, json.dumps(pl, ensure_ascii=False), json.dumps([win] if win else []), who))
    bump(con, owner, "frev")
    sys_msg(con, owner, "res", who, res=res, sum=summary("manual", b.get("name"), pl, [win] if win else [], None))
    return 201, {"id": res}


def results(con, owner, limit=400):
    out = []
    for i, ts, kind, name, pl, win, pod, by in con.execute("SELECT id, ts, kind, name, players, win, podium, by FROM taverna_results WHERE owner=? AND removed IS NULL"
                                                         " ORDER BY ts DESC, rowid DESC LIMIT ?", (owner, limit)):
        out.append({"id": i, "ts": ts, "kind": kind, "name": name, "players": json.loads(pl or "[]"), "win": json.loads(win or "[]"),
                    **({"podium": json.loads(pod)} if pod else {}), **({"by": by} if by else {})})
    return out


def fame(con, owner, me):
    """O Hall da Fama: a tabela (pontos, V/D/E, troféus, forma), os destaques e os últimos resultados."""
    nm = names(con, owner)
    rs = results(con, owner)
    S = {}
    pairs, decks = {}, {}

    def st(w):
        return S.setdefault(w, {"who": w, "name": nm.get(w) or "?", "g": 0, "w": 0, "l": 0, "d": 0, "pts": 0, "gold": 0, "silver": 0, "bronze": 0, "form": [], "streak": 0, "best": 0})
    for r in reversed(rs):  # do mais antigo para o mais recente: a forma e as séries
        if r["kind"] == "torneio":
            for p in r.get("podium") or []:
                s = st(p["who"])
                s["pts"] += PTS.get(p["place"], 0)
                s[{1: "gold", 2: "silver", 3: "bronze"}.get(p["place"], "bronze")] += 1
            continue
        ws = set(r["win"])
        whos = [p["who"] for p in r["players"]]
        for p in r["players"]:
            s = st(p["who"])
            s["g"] += 1
            if not ws:
                s["d"] += 1; s["pts"] += PTS["d"]; s["form"].append("E"); s["streak"] = 0
            elif p["who"] in ws:
                s["w"] += 1; s["pts"] += PTS["w"]; s["form"].append("V"); s["streak"] += 1; s["best"] = max(s["best"], s["streak"])
                if p.get("deck"):
                    k = (p["who"], p["deck"])
                    decks[k] = decks.get(k, 0) + 1
            else:
                s["l"] += 1; s["form"].append("D"); s["streak"] = 0
        for i, a in enumerate(whos):
            for b2 in whos[i + 1:]:
                k = tuple(sorted((a, b2)))
                q = pairs.setdefault(k, {k[0]: 0, k[1]: 0, "g": 0})
                q["g"] += 1
                for w in ws & set(k):
                    q[w] += 1
    cur = {m["who"] for m in members(con, owner)}
    table = sorted((s | {"form": s["form"][-5:], "pct": round(100 * s["w"] / s["g"]) if s["g"] else None, "member": s["who"] in cur, "me": s["who"] == me}
                    for s in S.values() if s["g"] or s["gold"] + s["silver"] + s["bronze"]),
                   key=lambda s: (-s["pts"], -s["w"], -(s["gold"] * 100 + s["silver"] * 10 + s["bronze"]), s["g"], s["name"].lower()))
    hot = max((s for s in table if s["streak"] >= 2), key=lambda s: (s["streak"], s["pts"]), default=None)
    gd = max(decks.items(), key=lambda kv: kv[1], default=None)
    rv = max(pairs.items(), key=lambda kv: kv[1]["g"], default=None)
    hl = {**({"hot": {"who": hot["who"], "name": hot["name"], "n": hot["streak"]}} if hot else {}),
          **({"deck": {"who": gd[0][0], "name": nm.get(gd[0][0]) or "?", "deck": gd[0][1], "n": gd[1]}} if gd and gd[1] >= 2 else {}),
          **({"rival": {"a": rv[0][0], "b": rv[0][1], "an": nm.get(rv[0][0]) or "?", "bn": nm.get(rv[0][1]) or "?", "aw": rv[1][rv[0][0]], "bw": rv[1][rv[0][1]], "g": rv[1]["g"]}}
             if rv and rv[1]["g"] >= 2 else {})}
    return {"table": table, "hl": hl, "feed": rs[:30], "pts": PTS | {"t1": PTS[1], "t2": PTS[2], "t3": PTS[3]}, "n": len(rs)}


# ---------- a vista ----------

def state(con, owner, who, q):
    t = row(con, owner)
    me_name = names(con, owner).get(who) if t else None
    if not t:
        return {"exists": False, "host": who == "host"}
    if not is_member(con, owner, who):
        r = con.execute("SELECT removed FROM taverna_members WHERE owner=? AND who=?", (owner, who)).fetchone()
        return {"exists": True, "member": False, "name": t["name"], "hostName": rooms.host_name(con, owner), "kicked": bool(r and r[0] and r[0] < 0),
                **({"closed": t["closed"]} if t["closed"] else {})}
    touch(con, owner, who, q.get("p", [None])[0] == "1" if "p" in q else None)
    reconcile(con, owner)
    t = row(con, owner)  # o reconcile pode ter anunciado salas (rev)
    nm = names(con, owner)
    mem = members(con, owner)
    for m in mem:
        m.update(presence(owner, m["who"]))
    since = int((q.get("since") or ["0"])[0] or 0)
    before = int((q.get("before") or ["0"])[0] or 0)
    if before:
        rs = con.execute(f"SELECT {MSG_COLS} FROM taverna_msgs WHERE owner=? AND id<? AND deleted IS NULL ORDER BY id DESC LIMIT 50", (owner, before)).fetchall()[::-1]  # noqa: S608
    elif since:
        rs = con.execute(f"SELECT {MSG_COLS} FROM taverna_msgs WHERE owner=? AND rev>? ORDER BY id LIMIT 300", (owner, since)).fetchall()  # noqa: S608
    else:
        rs = con.execute(f"SELECT {MSG_COLS} FROM taverna_msgs WHERE owner=? AND deleted IS NULL ORDER BY id DESC LIMIT 80", (owner,)).fetchall()[::-1]  # noqa: S608
    msgs = [view_msg(r, nm, who) for r in rs]
    first = msgs[0]["id"] if msgs and not since else None
    readid = (con.execute("SELECT readid FROM taverna_members WHERE owner=? AND who=?", (owner, who)).fetchone() or [0])[0]
    pins = [view_msg(r, nm, who) for r in con.execute(f"SELECT {MSG_COLS} FROM taverna_msgs WHERE owner=? AND pin=1 AND deleted IS NULL ORDER BY id DESC LIMIT 10", (owner,))]  # noqa: S608
    out = {"exists": True, "member": True, "me": {"who": who, "name": me_name, "host": who == "host"},
           "taverna": {"name": t["name"], "motto": t["motto"], "created": t["created"], **({"link": f"/taverna/{t['link']}"} if who == "host" else {}),
                       **({"closed": t["closed"]} if t["closed"] else {})},
           "rooms": {"per": ROOMS_PER, "mine": 0 if who == "host" else _open_rooms(con, owner, who)},
           "members": mem, "msgs": msgs, "rev": t["rev"], "srev": t["srev"], "frev": t["frev"], "read": readid, "pins": pins,
           **counts(con, owner, who, readid),
           **({"more": bool(con.execute("SELECT 1 FROM taverna_msgs WHERE owner=? AND id<? AND deleted IS NULL", (owner, first)).fetchone())} if first else {}),
           **({"more": len(rs) == 50} if before else {})}
    if who == "host":  # os amigos que já tens e ainda não estão na Taverna (para os pôr com um toque)
        inn = {m["who"] for m in mem}
        out["friends"] = [{"id": i, "name": SALA.sub("", n)} for i, n in con.execute("SELECT id, name FROM friends WHERE owner=? AND revoked IS NULL ORDER BY created DESC LIMIT 40", (owner,))
                          if f"guest:{i}" not in inn]
    return out


def counts(con, owner, who, readid):
    un = at = 0
    for x, w in con.execute("SELECT x, who FROM taverna_msgs WHERE owner=? AND id>? AND deleted IS NULL AND who<>? ORDER BY id DESC LIMIT 300", (owner, readid, who)):
        un += 1
        if who in (json.loads(x or "{}").get("at") or []):
            at += 1
    return {"unread": un, "at": at}


def route(con, method, path, owner, body, who, q=None):
    """GET /api/taverna[?since=rev|before=id] -> o estado; POST /api/taverna {name} cria (quem aloja); POST /api/taverna/<ação>.
    who = 'host' (quem aloja) ou 'guest:<id>' (um membro convidado)."""
    init(con)
    guests.init(con)
    q = q or {}
    m = PATH.match(path)
    if not m:
        return 404, {"erro": "rota desconhecida"}
    act, arg = m.group(1), m.group(2)
    host = who == "host"
    b = body if isinstance(body, dict) else {}
    if method == "GET":
        if act in (None,):
            return 200, state(con, owner, who, q)
        if not row(con, owner) or not is_member(con, owner, who):
            return 403, {"erro": "Não és membro desta Taverna."}
        touch(con, owner, who)
        nm = names(con, owner)
        if act == "shelf":
            return 200, shelf(con, owner, nm)
        if act == "deck" and arg:
            r = con.execute("SELECT who, deck FROM taverna_shelf WHERE owner=? AND id=? AND removed IS NULL", (owner, arg)).fetchone()
            return (200, {**json.loads(r[1]), "id": arg, "by": nm.get(r[0]) or "?", "who": r[0]}) if r else (404, {"erro": "Esse deck já não está na prateleira."})
        if act == "fame":
            reconcile(con, owner)
            return 200, fame(con, owner, who)
        if act == "live":
            return 200, rooms.live_step(rooms.LIVE.setdefault(f"tv:{owner}", {"seq": 0, "objs": {}, "open": None}), who, "GET", None)
        return 404, {"erro": "rota desconhecida"}
    if method != "POST":
        return 404, {"erro": "rota desconhecida"}
    if act is None:  # criar a Taverna (só quem aloja, uma por dono)
        if not host:
            return 403, {"erro": "Só quem aloja abre a Taverna."}
        if row(con, owner):
            return 409, {"erro": "Já tens uma Taverna."}
        tpl = clean(b.get("tpl"), 60) if "{n}" in str(b.get("tpl") or "") else "Taverna de {n}"  # o nome por omissão na língua de quem cria
        name = clean(b.get("name"), NAME_MAX) or tpl.replace("{n}", rooms.host_name(con, owner))[:NAME_MAX]
        con.execute("INSERT INTO taverna (owner, name, motto, link, created) VALUES (?,?,?,?,?)", (owner, name, clean(b.get("motto"), MOTTO_MAX) or None, secrets.token_urlsafe(12), time.time()))
        con.execute("INSERT OR REPLACE INTO taverna_members (owner, who, joined, seen) VALUES (?,?,?,?)", (owner, "host", time.time(), time.time()))
        sys_msg(con, owner, "open", "host")
        return 201, state(con, owner, who, {})
    if not row(con, owner):
        return 404, {"erro": "Ainda não há Taverna aqui."}
    if not is_member(con, owner, who):
        return 403, {"erro": "Não és membro desta Taverna."}
    if row(con, owner)["closed"] and act not in READ_ONLY:
        return 409, {"erro": CLOSED}
    if act == "ping":  # batimento (a app, de 25 em 25 s): -> por ler, menções, quem está ligado
        touch(con, owner, who, b.get("playing"))
        readid = (con.execute("SELECT readid FROM taverna_members WHERE owner=? AND who=?", (owner, who)).fetchone() or [0])[0]
        on = [m for m in members(con, owner) if m["who"] != who and presence(owner, m["who"])["online"]]
        return 200, {"exists": True, "member": True, "name": row(con, owner)["name"], "online": len(on), **counts(con, owner, who, readid)}
    touch(con, owner, who)
    if act == "say":
        return say(con, owner, who, b)
    if act in ("react", "pin", "del"):
        return msg_edit(con, owner, who, act, b)
    if act == "read":
        mid = b.get("id")
        if isinstance(mid, int):
            con.execute("UPDATE taverna_members SET readid=max(readid, ?) WHERE owner=? AND who=?", (mid, owner, who))
        return 200, counts(con, owner, who, (con.execute("SELECT readid FROM taverna_members WHERE owner=? AND who=?", (owner, who)).fetchone() or [0])[0])
    if act == "share":
        return share_deck(con, owner, who, b)
    if act in ("unshare", "took"):
        r = con.execute("SELECT who FROM taverna_shelf WHERE owner=? AND id=? AND removed IS NULL", (owner, str(b.get("id") or ""))).fetchone()
        if not r:
            return 404, {"erro": "Esse deck já não está na prateleira."}
        if act == "took":  # alguém copiou o deck para os seus (o contador da prateleira)
            if r[0] != who and not guests.slow(("taverna-took", owner, who, b["id"]), 1, 3600):
                con.execute("UPDATE taverna_shelf SET took=took+1 WHERE id=?", (b["id"],))
                bump(con, owner, "srev")
            return 200, {"ok": True}
        if r[0] != who and not host:
            return 403, {"erro": "Só quem o pôs ou quem aloja tira este deck."}
        con.execute("UPDATE taverna_shelf SET removed=? WHERE id=?", (time.time(), b["id"]))
        bump(con, owner, "srev")
        return 200, {"ok": True}
    if act == "live":  # a mesa 3D da prateleira: as caixas e as cartas que cada um atira (rooms.live_step)
        return 200, rooms.live_step(rooms.LIVE.setdefault(f"tv:{owner}", {"seq": 0, "objs": {}, "open": None}), who, "POST", b)
    if act == "result":
        return add_result(con, owner, who, b)
    if act == "unresult":
        r = con.execute("SELECT by FROM taverna_results WHERE owner=? AND id=? AND removed IS NULL", (owner, str(b.get("id") or ""))).fetchone()
        if not r:
            return 404, {"erro": "Esse resultado já não existe."}
        if not host and r[0] != who:
            return 403, {"erro": "Só quem o registou ou quem aloja apaga este resultado."}
        con.execute("UPDATE taverna_results SET removed=? WHERE id=?", (time.time(), b["id"]))
        bump(con, owner, "frev")
        return 200, {"ok": True}
    if act == "leave" and not host:  # sair por mim: posso voltar pelo link
        con.execute("UPDATE taverna_members SET removed=? WHERE owner=? AND who=?", (time.time(), owner, who))
        sys_msg(con, owner, "leave", who)
        return 200, {"ok": True}
    if not host:
        return 403, {"erro": "Só quem aloja pode fazer isto."}
    if act == "kick":  # tirar alguém (removed < 0: o link já não o deixa voltar; quem aloja pode voltar a pô-lo)
        w = str(b.get("who") or "")
        if w == "host" or not con.execute("SELECT 1 FROM taverna_members WHERE owner=? AND who=? AND removed IS NULL", (owner, w)).fetchone():
            return 404, {"erro": "Essa pessoa não está na Taverna."}
        con.execute("UPDATE taverna_members SET removed=? WHERE owner=? AND who=?", (-time.time(), owner, w))
        sys_msg(con, owner, "kick", w)
        return 200, {"ok": True}
    if act == "add":  # um amigo que já tenho (Definições › Amigos) entra sem precisar do link
        fid = str(b.get("id") or "")
        if not con.execute("SELECT 1 FROM friends WHERE id=? AND owner=? AND revoked IS NULL", (fid, owner)).fetchone():
            return 404, {"erro": "Esse amigo não existe."}
        con.execute("DELETE FROM taverna_members WHERE owner=? AND who=? AND removed IS NOT NULL", (owner, f"guest:{fid}"))  # tirado ou saiu: volta
        add_member(con, owner, f"guest:{fid}")
        return 200, {"ok": True}
    if act == "link":  # um link novo: o antigo deixa de entrar (quem já é membro fica)
        con.execute("UPDATE taverna SET link=? WHERE owner=?", (secrets.token_urlsafe(12), owner))
        return 200, {"link": f"/taverna/{row(con, owner)['link']}"}
    if act == "edit":
        name, motto = clean(b.get("name"), NAME_MAX), clean(b.get("motto"), MOTTO_MAX)
        if not name:
            return 400, {"erro": "A Taverna precisa de um nome."}
        con.execute("UPDATE taverna SET name=?, motto=? WHERE owner=?", (name, motto or None, owner))
        bump(con, owner)
        return 200, {"ok": True}
    if act in ("close", "reopen"):  # fechar: fica só de leitura e o link deixa de deixar entrar; reabrir volta a como estava
        closed = row(con, owner)["closed"]
        if bool(closed) == (act == "close"):
            return 200, {"ok": True}
        if act == "reopen":
            con.execute("UPDATE taverna SET closed=NULL WHERE owner=?", (owner,))
        sys_msg(con, owner, act, "host")  # antes de fechar (e depois de reabrir): a última linha da conversa diz porquê
        if act == "close":
            con.execute("UPDATE taverna SET closed=? WHERE owner=?", (time.time(), owner))
        return 200, {"ok": True}
    if act == "delete":  # apagar de vez: só com o nome escrito à mão; os amigos (convites) ficam em Definições › Amigos
        if clean(b.get("name"), NAME_MAX).casefold() != row(con, owner)["name"].strip().casefold():
            return 400, {"erro": "Escreve o nome da Taverna para a apagar."}
        for tb in ("taverna_msgs", "taverna_shelf", "taverna_results", "taverna_members", "taverna"):
            con.execute(f"DELETE FROM {tb} WHERE owner=?", (owner,))  # noqa: S608 — nomes fixos
        rooms.LIVE.pop(f"tv:{owner}", None)
        _REC.pop(owner, None)
        for k in [k for k in PRES if k[0] == owner]:
            del PRES[k]
        return 200, {"ok": True, "deleted": True}
    return 404, {"erro": "rota desconhecida"}


# ---------- o link: /taverna/<link> ----------

def by_link(con, token):
    init(con)
    r = con.execute("SELECT owner, name, closed FROM taverna WHERE link=?", (str(token)[:40],)).fetchone()
    return r and {"owner": r[0], "name": r[1], "closed": r[2]}


def _join_token(con, owner, tok):
    g = guests.by_token(con, tok)
    add_member(con, owner, f"guest:{g['id']}")
    return tok


def link_page(h, con, token, name, me=None, act=""):
    """GET /taverna/<link>[?nome=…]: quem aloja vai para a Taverna; um convidado deste Grimório fica membro e entra; os
    outros escolhem um nome (convidado novo, no browser) ou abrem o link na app deles (/info -> JSON para a app)."""
    import html
    t = by_link(con, token)
    if act == "info":
        return h.json({"api": guests.API, "kind": "taverna", "name": t["name"], "hid": guests.host_id(con)}) if t and not t["closed"] \
            else h.json({"erro": CLOSED_LINK if t else "Este link da Taverna já não é válido."}, 403 if t else 404)
    L = guests.lang(h)
    if not t or act:
        return guests._page(h, f"<p>{guests.t(L, 'tv_bad')}</p>", 404, L)
    owner = t["owner"]
    go = lambda tok: h.send(302, b"", "text/plain", {"Location": "/#taverna", **({"Set-Cookie": f"{guests.COOKIE}={tok}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly"} if tok else {})})  # noqa: E731
    try:
        if me and me.get("owner") == owner:
            return go(None)
        if t["closed"]:
            raise PermissionError(CLOSED_LINK)
        g = guests.by_token(con, guests.cookie_token(h.headers))
        if g and g["owner"] == owner:  # já é convidado deste Grimório: fica membro
            add_member(con, owner, f"guest:{g['id']}")
            return go(None)
        name = re.sub(r"[<>&\"']", "", str(name or "")).strip()[:30]
        if not name:
            prof = me and me.get("profile")
            mine = (f"<form method=post action='/taverna/{html.escape(token)}/perfil'><button class=go>{guests.t(L, 'as_prof', n=prof['name'])}</button>"
                    f" <small>{guests.t(L, 'as_prof_s')}</small></form><p><small>{guests.t(L, 'other')}</small></p>") if prof else ""
            return guests._page(h, f"<h2>🍺 {html.escape(t['name'])}</h2><div class=box>{guests.t(L, 'tv_box')}</div>" + ("" if prof else guests.app_btn(L)) + mine +
                                f"<form><p>{guests.t(L, 'tv_p')}</p><input name=nome maxlength=30 required placeholder='{html.escape(guests.t(L, 'name_ph'))}'"
                                f" style='width:100%;box-sizing:border-box'><p><button class=go>{guests.t(L, 'tv_enter')}</button></p></form>"
                                f"<div class=box><b>{guests.t(L, 'has_app')}</b><br><small>{guests.t(L, 'tv_app')}</small></div>", 200, L)
        fid, tok = secrets.token_hex(6), secrets.token_urlsafe(18)
        con.execute("INSERT INTO friends (id, owner, name, token, created, revoked) VALUES (?,?,?,?,?,NULL)", (fid, owner, f"{name} (taverna)", tok, time.time()))
        add_member(con, owner, f"guest:{fid}")
        return go(tok)
    except PermissionError as e:
        k = guests.ERR_KEY.get(str(e))
        return guests._page(h, f"<p>{guests.t(L, k) if k else html.escape(str(e))}</p>", 403, L)


def link_post(h, con, token, act, me):
    """POST /taverna/<link>/perfil (um perfil deste Grimório, no mesmo browser) | /trazer {name, key} (a app de um amigo)."""
    t = by_link(con, token)
    if not t:
        return h.json({"erro": "Este link da Taverna já não é válido."}, 404)
    if t["closed"]:
        return h.json({"erro": CLOSED_LINK}, 403)
    owner = t["owner"]
    try:
        if act == "perfil":
            prof = me and me.get("profile")
            if not prof:
                return h.json({"erro": "Não há perfil escolhido neste browser."}, 400)
            tok = _join_token(con, owner, guests.link_friend(con, owner, f"local:{prof['id']}", prof["name"], []))
            return h.send(303, b"", "text/plain", {"Location": "/#taverna", "Set-Cookie": f"{guests.COOKIE}={tok}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly"})
        if act == "trazer":
            d = h.body()
            key = str((d or {}).get("key") or "") if isinstance(d, dict) else ""
            if not re.fullmatch(r"[A-Za-z0-9_-]{24,100}", key):
                return h.json({"erro": "Pedido inválido."}, 400)
            if guests.slow(("taverna-link", token)):
                return h.json({"erro": "Demasiados pedidos: espera um minuto."}, 429)
            decks = d.get("decks") if isinstance(d.get("decks"), list) else []
            return h.json({"go": f"/convite/{_join_token(con, owner, guests.link_friend(con, owner, 'app:' + key, d.get('name'), decks))}?entrar=1"})
    except PermissionError as e:
        return h.json({"erro": str(e)}, 403)
    except ValueError as e:
        return h.json({"erro": str(e)}, 400)
    return h.json({"erro": "rota desconhecida"}, 404)


def selfcheck():
    """Membros, fronteira de quem aloja, limites e limpeza da conversa, prateleira e Hall da Fama (base temporária)."""
    import sqlite3
    con = sqlite3.connect(":memory:")
    con.execute("CREATE TABLE decks (id TEXT PRIMARY KEY, name TEXT, format TEXT, body TEXT NOT NULL, updated REAL NOT NULL, owner TEXT, deleted REAL)")
    guests.init(con)
    H, R, E = "host", "guest:aaaaaaaaaaaa", "guest:bbbbbbbbbbbb"
    for fid, n in (("aaaaaaaaaaaa", "Rui (sala)"), ("bbbbbbbbbbbb", "Eva"), ("cccccccccccc", "Zé")):
        con.execute("INSERT INTO friends (id, owner, name, token, created) VALUES (?,?,?,?,?)", (fid, "o", n, "t" + fid, time.time()))
    call = lambda who, act=None, b=None, method="POST", q=None: route(con, method, "/api/taverna" + (f"/{act}" if act else ""), "o", b, who, q)  # noqa: E731
    assert call(H, method="GET")[1] == {"exists": False, "host": True}
    assert call(R, b={"name": "X"})[0] == 403  # um convidado não abre a Taverna de quem aloja
    st, s = call(H, b={"name": "  A <b>Taverna</b>‮\x00 ", "motto": "x" * 500})
    assert st == 201 and s["taverna"]["name"] == "A <b>Taverna</b>" and s["taverna"]["link"].startswith("/taverna/") and call(H, b={})[0] == 409
    assert len(con.execute("SELECT motto FROM taverna").fetchone()[0]) == MOTTO_MAX
    assert call(R, method="GET")[1]["member"] is False and call(R, "say", {"m": "olá"})[0] == 403  # ainda não é membro
    add_member(con, "o", R)
    add_member(con, "o", E)
    s = call(R, method="GET")[1]
    assert s["member"] and "link" not in s["taverna"] and [m["name"] for m in s["members"]] == ["o", "Rui", "Eva"] and "friends" not in s
    assert call(H, method="GET")[1]["friends"] == [{"id": "cccccccccccc", "name": "Zé"}]
    # conversa: limpa, com limites, menções (o nome mais comprido primeiro) e por ler
    assert call(R, "say", {"m": "   "})[0] == 400
    st, j = call(R, "say", {"m": "ola @Eva e @o‮ <script>alert(1)</script>" + "x" * 900})
    assert st == 201
    msg = call(E, method="GET")[1]["msgs"][-1]
    assert len(msg["m"]) == MSG_MAX and "‮" not in msg["m"] and msg["at"] == [E, H] and msg["name"] == "Rui" and not msg["mine"]
    assert call(E, method="GET")[1]["at"] == 1 and call(E, "read", {"id": j["id"]})[1] == {"unread": 0, "at": 0}
    assert call(R, method="GET")[1]["unread"] == 0  # a minha não conta como por ler
    for _ in range(19):
        call(R, "say", {"m": "spam"})
    assert call(R, "say", {"m": "uma a mais"})[0] == 429  # 20 por minuto
    guests._HITS.clear()
    assert call(E, "react", {"id": j["id"], "e": "<img>"})[0] == 400 and call(E, "react", {"id": j["id"], "e": "🔥"})[0] == 200
    rev = call(H, method="GET")[1]["rev"]
    call(R, "react", {"id": j["id"], "e": "🔥"})
    ch = call(H, method="GET", q={"since": [str(rev)]})[1]["msgs"]
    assert [m["id"] for m in ch] == [j["id"]] and ch[0]["react"] == {"🔥": [E, R]}  # a mudança chega a quem só pede as novas
    assert call(E, "del", {"id": j["id"]})[0] == 403 and call(E, "pin", {"id": j["id"]})[0] == 403  # não é dele
    assert call(H, "pin", {"id": j["id"]})[0] == 200 and call(E, method="GET")[1]["pins"][0]["id"] == j["id"]
    assert call(R, "del", {"id": j["id"]})[0] == 200 and call(E, method="GET")[1]["pins"] == []
    # prateleira: cópia limpa do deck, o mesmo nome atualiza, menção de deck só da prateleira
    assert call(E, "share", {"deck": {"name": "Vazio", "main": {}}})[0] == 400
    st, sh = call(E, "share", {"deck": {"name": "Elfos", "format": "modern", "main": {"Llanowar Elves": 4, "x" * 300: 999, "Forest": 20}, "friend": "zzz", "body": "<b>"}})
    assert st == 201 and call(E, "share", {"deck": {"name": "Elfos", "main": {"Forest": 60}}})[1] == {"id": sh["id"], "updated": True}
    d = call(R, "deck", method="GET")  # sem id
    assert d[0] == 404
    d = route(con, "GET", f"/api/taverna/deck/{sh['id']}", "o", None, R)[1]
    assert d["main"] == {"Forest": 60} and d["by"] == "Eva" and "friend" not in d
    assert call(R, "say", {"decks": [sh["id"], "ffffffffffff"], "m": "vê #Elfos"})[0] == 201
    assert call(H, method="GET")[1]["msgs"][-1]["decks"] == [sh["id"]]
    assert call(R, "unshare", {"id": sh["id"]})[0] == 403 and call(R, "took", {"id": sh["id"]})[0] == 200
    assert call(E, "shelf", method="GET")[1][0]["took"] == 1
    # fronteira de quem aloja
    for a, bb in (("kick", {"who": E}), ("add", {"id": "cccccccccccc"}), ("link", {}), ("edit", {"name": "X"})):
        assert call(R, a, bb)[0] == 403, a
    old = call(H, method="GET")[1]["taverna"]["link"]
    assert call(H, "link")[1]["link"] != old and by_link(con, old.split("/")[-1]) is None
    assert call(H, "kick", {"who": E})[0] == 200 and call(E, method="GET")[1]["member"] is False
    try:
        add_member(con, "o", E)
        raise AssertionError("tirado: o link não o deixa voltar")
    except PermissionError:
        pass
    assert call(H, "add", {"id": "bbbbbbbbbbbb"})[0] == 200 and call(E, method="GET")[1]["member"] is True
    con.execute("UPDATE friends SET revoked=? WHERE id='bbbbbbbbbbbb'", (time.time(),))
    assert call(E, method="GET")[1]["member"] is False  # convite revogado: deixa de ser membro
    con.execute("UPDATE friends SET revoked=NULL WHERE id='bbbbbbbbbbbb'")
    # presença
    call(E, "ping", {"playing": True})
    m = {x["who"]: x for x in call(H, method="GET")[1]["members"]}
    assert m[E]["online"] and m[E]["playing"] and not m[R]["playing"] and call(H, "ping")[1]["online"] >= 1
    # a mesa 3D da prateleira: o canal ao vivo das salas (rooms.live_step), com limites
    call(R, "live", {"objs": [{"id": "x" * 200, "x": 999, "z": -3}], "ptr": {"x": 1, "z": 2, "n": "Rui"}})
    lv = call(H, "live", method="GET")[1]
    assert lv["objs"]["x" * 80]["x"] == 20.0 and lv["objs"]["x" * 80]["by"] == R and lv["ptr"][R]["n"] == "Rui" and lv["me"] == H
    assert call("guest:cccccccccccc", "live", {"objs": []})[0] == 403  # quem não é membro não mexe
    # Hall da Fama: resultados à mão (só membros, quem regista joga) e a tabela
    assert call(R, "result", {"players": [R]})[0] == 400 and call(R, "result", {"players": [H, E]})[0] == 403
    assert call(R, "result", {"players": [R, E], "win": "guest:cccccccccccc"})[0] == 400
    for w in (R, R, E, None):
        assert call(R, "result", {"players": [R, E], "win": w, "decks": {R: "Mono-vermelho"}})[0] == 201
    f = call(E, "fame", method="GET")[1]
    top = f["table"][0]
    assert top["who"] == R and (top["w"], top["l"], top["d"], top["pts"]) == (2, 1, 1, 7) and top["form"] == ["V", "V", "D", "E"]
    assert f["hl"]["rival"]["g"] == 4 and f["hl"]["deck"]["deck"] == "Mono-vermelho" and len(f["feed"]) == 4
    rid = f["feed"][0]["id"]
    assert call(E, "unresult", {"id": rid})[0] == 403 and call(H, "unresult", {"id": rid})[0] == 200
    # mesas abertas por membros (rooms.guest_room): só membros, só mesa livre/estrita, com um deck seu, no máximo ROOMS_PER abertas
    guests._HITS.clear()
    for fid in ("aaaaaaaaaaaa", "bbbbbbbbbbbb", "cccccccccccc"):
        con.execute("INSERT INTO decks (id, name, format, body, updated, owner) VALUES (?,?,?,?,?,?)",
                    (f"d{fid}", f"Deck {fid[0]}", "modern", json.dumps({"name": f"Deck {fid[0]}", "main": {"Forest": 60}, "friend": fid}), time.time(), "o"))
    gR, gE, gZ = {"id": "aaaaaaaaaaaa", "name": "Rui (sala)"}, {"id": "bbbbbbbbbbbb", "name": "Eva"}, {"id": "cccccccccccc", "name": "Zé"}
    mk = lambda g, ref=None, **k: rooms.route(con, "POST", "/api/rooms", "o", {"type": "livre", "name": "Mesa ‮x", "players": [{"src": "meus", "ref": ref or f"d{g['id']}"}], **k}, guest=g)  # noqa: E731
    rl = lambda g: {x["id"]: x for x in rooms.route(con, "GET", "/api/rooms", "o", None, guest=g)[1]}  # noqa: E731
    assert mk(gZ)[0] == 403 and mk(gR, type="torneio")[0] == 403 and mk(gR, "dbbbbbbbbbbbb")[0] == 400  # não é membro; torneio; deck da Eva
    st, r1 = mk(gR, strict=True, max=9)
    assert st == 201, r1
    v = rl(gR)[r1["id"]]
    assert v["own"] and v["opener"] == "Rui (sala)" and v["max"] == 4 and v["strict"] and v["name"] == "Mesa x" and "link" not in v and v["players"][0]["mine"]
    assert rl(gE)[r1["id"]]["own"] is False and rooms.route(con, "POST", f"/api/rooms/{r1['id']}/cancel", "o", None, guest=gE)[0] == 403
    assert rooms.route(con, "POST", f"/api/rooms/{r1['id']}/start", "o", None, guest=gE)[0] == 403  # só quem a abriu (ou quem aloja) a começa
    assert rooms.route(con, "POST", f"/api/rooms/{r1['id']}/join", "o", {"deck": "dbbbbbbbbbbbb"}, guest=gE)[0] == 200  # os outros sentam-se
    assert mk(gR)[0] == 201 and mk(gR)[1] == {"erro": "Já tens 2 mesas abertas: cancela uma primeiro."} and call(R, method="GET")[1]["rooms"] == {"per": ROOMS_PER, "mine": 2}
    assert rooms.route(con, "POST", f"/api/rooms/{r1['id']}/cancel", "o", None, guest=gR)[0] == 200 and mk(gR)[0] == 201  # a vaga volta
    guests._HITS[("taverna-room", "o", E)] = [time.time()] * 4
    assert mk(gE)[0] == 429  # 4 por minuto
    reconcile(con, "o", force=True)
    assert {m["who"] for m in call(H, method="GET")[1]["msgs"] if m["kind"] == "room"} == {R}  # anunciadas em nome de quem as abriu
    # fechar: só de leitura, o link não deixa entrar, nada de mesas novas; reabrir; apagar só com o nome
    lk = call(H, method="GET")[1]["taverna"]["link"].split("/")[-1]
    assert call(R, "close")[0] == 403 and call(H, "close")[0] == 200
    s = call(R, method="GET")[1]
    assert s["member"] and s["taverna"]["closed"] and s["msgs"][-1]["kind"] == "close"
    for a, bb in (("say", {"m": "x"}), ("share", {"deck": {"name": "D", "main": {"Forest": 1}}}), ("result", {"players": [R, E]}), ("live", {}), ("kick", {"who": E})):
        assert call(R if a != "kick" else H, a, bb)[1].get("erro") == CLOSED, a
    assert call(R, "read", {"id": 1})[0] == 200 and call(R, "ping")[0] == 200 and mk(gE)[1]["erro"] == CLOSED
    try:
        add_member(con, "o", "guest:cccccccccccc")
        raise AssertionError("fechada: ninguém entra")
    except PermissionError:
        pass

    class FakeH:  # o bastante do pedido HTTP para as páginas dos links
        def __init__(s, path, lang="", cookie=""):
            s.path, s.headers = path, {"Accept-Language": lang, **({"Cookie": cookie} if cookie else {})}

        def send(s, code, body, ctype, hdrs=None):
            return code, body.decode() if isinstance(body, bytes) else body, hdrs or {}

        def json(s, obj, code=200):
            return code, obj, {}
    nf = con.execute("SELECT COUNT(*) FROM friends").fetchone()[0]
    st, pg, _ = link_page(FakeH(f"/taverna/{lk}?nome=Ana", "en-GB,en;q=0.8"), con, lk, "Ana")
    assert st == 403 and guests.TXT["en"]["tv_closed"] in pg and con.execute("SELECT COUNT(*) FROM friends").fetchone()[0] == nf
    assert link_page(FakeH(f"/taverna/{lk}/info"), con, lk, "", act="info")[0] == 403 and link_post(FakeH(f"/taverna/{lk}/trazer"), con, lk, "trazer", None)[0] == 403
    assert call(H, "reopen")[0] == 200 and call(R, "say", {"m": "voltámos"})[0] == 201 and not call(R, method="GET")[1]["taverna"].get("closed")
    # a página do link na língua de quem a abre (Accept-Language, ?lang=), sem frases em pt nas outras
    for al, q, L in (("pt-BR,pt;q=0.9", "", "pt"), ("en-US,en;q=0.9", "", "en"), ("fr-FR,fr;q=0.9", "", "en"), ("de;q=0.2,zh-CN;q=0.9", "", "zh"), ("pt-PT", "?lang=es", "es")):
        st, pg, _ = link_page(FakeH(f"/taverna/{lk}{q}", al), con, lk, "")
        assert st == 200 and f"<html lang={guests.LANGS[L][0]}>" in pg and guests.TXT[L]["tv_enter"] in pg and guests.TXT[L]["app"] in pg, (al, L)
        assert ("grimorio.lang" in pg) == bool(q) and (L == "pt" or not guests.pt_left(pg, L)), (L, guests.pt_left(pg, L))
    assert guests.TXT["pt"]["tv_box"] in link_page(FakeH(f"/taverna/{lk}", "pt-PT"), con, lk, "")[1]
    st, pg, _ = link_page(FakeH("/taverna/naoexiste", "de"), con, "naoexiste", "")
    assert st == 404 and guests.TXT["de"]["tv_bad"] in pg
    # apagar de vez: com o nome escrito (sem contar maiúsculas); some tudo e pode abrir-se outra
    nm0 = row(con, "o")["name"]
    assert call(R, "delete", {"name": nm0})[0] == 403 and call(H, "delete", {"name": "outra"})[0] == 400 and row(con, "o")
    assert call(H, "delete", {"name": f"  {nm0.upper()} "})[1] == {"ok": True, "deleted": True}
    for tb in ("taverna", "taverna_members", "taverna_msgs", "taverna_shelf", "taverna_results"):
        assert con.execute(f"SELECT COUNT(*) FROM {tb} WHERE owner='o'").fetchone()[0] == 0, tb  # noqa: S608
    assert call(R, method="GET")[1] == {"exists": False, "host": False} and by_link(con, lk) is None and mk(gR)[0] == 403
    assert call(H, b={"name": "Outra"})[0] == 201 and call(R, method="GET")[1]["member"] is False  # uma nova começa sem os membros antigos
    print("selfcheck taverna ok")
