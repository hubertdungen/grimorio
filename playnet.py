"""Forge Play nativo: um jogo teu (humano) contra a IA do Forge, jogado no browser com o ecrã do Grimório.

O GrimorioNet (build/forge/GrimorioNet.java) faz de «ecrã» do humano dentro do Forge e fala em linhas JSON
(@@GN {...}); aqui arranca-se (contentor no servidor ou Java local nos pacotes), guarda-se o último estado, o pedido
atual e as escolhas pendentes, e o browser lê por pedidos de espera longa (`since`) e manda comandos.
Sem Commander: só formatos 1 contra 1 construídos (o EDH fica para a app do Júlio).
"""
import json, os, subprocess, threading, time, uuid

import sim

S = {}                      # sessão -> {owner, p, seq, state, prompt, asks, log, ended, winner, ts}
COND = threading.Condition()
OK_CMDS = {"ok", "cancel", "card", "player", "answer", "mana", "alpha", "undo", "concede", "state"}
IDLE = 2 * 3600             # um jogo parado há mais de 2 h fecha-se
AFK = 300                   # mesa estrita (pessoa contra pessoa): quem deve uma decisão e não mexe há 5 min desiste
ON_END = None               # server.py: ON_END(rate, side) quando um jogo acaba com vencedor (ratings, uma vez por jogo)
ON_KEEP = None              # server.py: ON_KEEP(owner, jogo) quando acaba um jogo avulso contra o Forge (s["keep"]): «Os meus jogos»


def _over(s, winner):
    """O jogo acabou (mensagem «end» do GrimorioNet ou o estado já diz «over»): quem ganhou e se conta para os ratings."""
    if s["ended"] and s.get("side_set"):
        return None
    s["ended"], s["winner"], s["side_set"] = True, winner, True
    pl = s.get("players") or {}
    s["side"] = next((k2 for k2, n in pl.items() if n and n == winner), None)  # quem ganhou: a (tu) ou b
    if s.get("rate") and s["side"] and not s.get("rated"):
        s["rated"] = True
        return (s["rate"], s["side"])
    return None


def _reader(sid, p):
    for raw in p.stdout:
        line = raw.decode("utf-8", "replace").rstrip("\n")
        if not line.startswith("@@GN "):
            continue
        try:
            m = json.loads(line[5:])
        except ValueError:
            continue
        with COND:
            s = S.get(sid)
            if not s:
                break
            k, rate = m.get("t"), None
            v = s["pv"].get(m.get("s")) if s.get("pv") else None  # mesa estrita: cada lugar tem o seu estado, pedido e escolhas
            v = v if v is not None else s
            if k == "state":
                v["state"] = m
                if v is s or m.get("s") == "a":  # réplica: o estado de quem joga (na mesa estrita, o lugar a)
                    _snap(s, m)
                if m.get("over") and m.get("winner"):
                    rate = _over(s, m.get("winner"))
            elif k == "prompt":
                v["prompt"] = m
                v["since"] = time.time()
            elif k == "ask":
                v["asks"][m["id"]] = m
                v["since"] = time.time()
            elif k in ("msg", "flash"):
                v["log"] = (v["log"] + [m])[-40:]
            elif k == "crash":  # a thread do jogo do Forge morreu (GrimorioNet.watchdog): acaba sem vencedor
                s["crash"] = True
            elif k == "end":
                s["out"], s["draw"] = m.get("out") or s.get("out"), bool(m.get("draw"))  # como perdeu cada um (a esfera rebenta à maneira) e empate
                rate = _over(s, m.get("winner") or s.get("winner"))
            s["seq"] += 1
            s["ts"] = time.time()
            COND.notify_all()
        if rate and ON_END:  # fora do cadeado: escreve na base de dados
            try:
                ON_END(*rate)
            except Exception as e:  # um erro nos ratings não pode parar o jogo
                print("playnet: ratings:", e, flush=True)
    with COND:
        s = S.get(sid)
        keep = None
        if s:
            s["ended"] = True
            s["seq"] += 1
            COND.notify_all()
            if s.get("keep") and s.get("snaps") and not s.get("kept"):  # um jogo avulso: guarda-se para rever («Os meus jogos»)
                s["kept"] = True
                keep = (s["keep"], {"names": s.get("names"), "players": s.get("players"), "winner": s.get("side"), "turns": (s["state"] or {}).get("turn"),
                                    "snaps": list(s["snaps"]), "out": s.get("out"), "ts": time.time()})
    if keep and ON_KEEP:
        try:
            ON_KEEP(*keep)
        except Exception as e:  # guardar a réplica não pode parar nada
            print("playnet: os meus jogos:", e, flush=True)


SNAPS = 400  # fotografias do estado por jogo, no máximo (as do fim ficam: tira-se do meio)


def _snap(s, m):
    """Guarda uma fotografia do estado quando o jogo muda de facto (turno, fase, vidas, cartas em jogo e nos montes),
    sem as mãos dos outros (só quantas) nem o que é só do ecrã (jogáveis, pedidos)."""
    ps = m.get("players") or []
    sig = json.dumps([m.get("turn"), m.get("phase"), [(p.get("life"), len(p.get("hand") or []), [(c.get("id"), c.get("tapped")) for c in p.get("battlefield") or []],
                                                     len(p.get("graveyard") or []), len(p.get("exile") or [])) for p in ps], len(m.get("stack") or [])])
    if sig == s.get("snapsig"):
        return
    s["snapsig"] = sig
    keep = ("turn", "phase", "active", "combat", "over", "winner")
    st = {k: m[k] for k in keep if k in m}
    st["players"] = [{**{k: v for k, v in p.items() if k not in ("hand", "playable")}, "hand": [{"hidden": True}] * len(p.get("hand") or [])} for p in ps]
    act = next((p.get("name") for p in ps if p.get("id") == m.get("active")), "")
    sn = s.setdefault("snaps", [])
    sn.append({"st": st, "txt": f"T{m.get('turn') or 0} · {act} · {m.get('phase') or ''}".strip(" ·")})
    if len(sn) > SNAPS:
        del sn[len(sn) // 2]


def _cleanup():
    with COND:
        for sid in [k for k, s in S.items() if time.time() - s["ts"] > IDLE]:
            _kill(S.pop(sid))


def _kill(s):
    try:
        s["p"].kill()
    except Exception:
        pass
    if s.get("container"):
        subprocess.run(["docker", "kill", s["container"]], capture_output=True)


def start(data_dir, owner, deck, opp, difficulty="default", name="Tu", rate=None, chooser=None):
    """deck/opp = {name, main, side, commanders}; devolve o id da sessão. Um jogo de cada vez por dono. rate: para os
    ratings quando acabar (ratings.from_forgeplay), ou None (não conta)."""
    _cleanup()
    for d in (deck, opp):
        if not isinstance(d, dict) or not isinstance(d.get("main"), dict) or not d["main"]:
            raise ValueError("Falta um dos decks.")
        if d.get("commanders"):
            raise ValueError("O Forge Play é só para formatos 1 contra 1 (sem Commander).")
    with COND:
        for sid in [k for k, s in S.items() if s["owner"] == owner and not s.get("seats")]:
            _kill(S.pop(sid))
    profs = {i: p for i, p, *_ in sim.DIFFICULTIES}
    oname = str(opp.get("name") or "Forge")[:40]
    sid, p, container = _spawn(data_dir, deck, opp, [str(name)[:40] or "Tu", profs.get(difficulty) or "Default", oname] + (["ai", chooser] if chooser in ("a", "b") else []), ai_b=True)
    with COND:
        S[sid] = {"owner": owner, "p": p, "container": container, "seq": 0, "state": None, "prompt": None, "asks": {}, "log": [],
                  "ended": False, "winner": None, "ts": time.time(), "names": {"a": deck.get("name"), "b": opp.get("name")},
                  "players": {"a": str(name)[:40] or "Tu", "b": oname}, "rate": rate, "chooser": chooser in ("a", "b"),  # jogo 2+ de uma série: sem moeda
                  "arts": {"a": sim.art_map(deck), "b": sim.art_map(opp)}}  # a arte escolhida de cada carta (edição, imagem própria, básicos divididos)
    threading.Thread(target=_reader, args=(sid, p), daemon=True).start()
    return sid


def start_pvp(data_dir, seats, decks, names, afk=AFK, clock=None, chooser=None, mode=None):
    """Mesa estrita: 2 a 4 pessoas no mesmo jogo do Forge, cada uma com o seu ecrã (o GrimorioNet com vários humanos).
    seats = {"a": chave, "b": chave[, "c", "d"]} (o dono ou «<dono>~guest:<id>»); decks/names com as mesmas letras.
    mode (3–4 lugares): "ffa" todos contra todos ou "2hg" Two-Headed Giant (a+b contra c+d, só a 4). Devolve o id."""
    _cleanup()
    ks = [k for k in "abcd" if k in seats]
    if ks != list("abcd"[:len(ks)]) or not 2 <= len(ks) <= 4:
        raise ValueError("A mesa estrita leva de 2 a 4 jogadores.")
    if mode == "2hg" and len(ks) != 4:
        raise ValueError("O Two-Headed Giant é para 4 jogadores.")
    for k in ks:
        d = decks.get(k)
        if not isinstance(d, dict) or not isinstance(d.get("main"), dict) or not d["main"]:
            raise ValueError("Falta um dos decks.")
        if d.get("commanders"):
            raise ValueError("A mesa estrita é só para formatos 1 contra 1 (sem Commander).")
    nm = {}
    for k in ks:  # quem ganhou vem pelo nome: têm de ser todos diferentes
        n0 = str(names.get(k) or f"Jogador {'abcd'.index(k) + 1}")[:40]
        nm[k] = n0 if n0 not in nm.values() else f"{n0[:36]} ({'abcd'.index(k) + 1})"
    extra = [(k, decks[k], nm[k]) for k in ks[2:]]
    args = [nm["a"], "Default", nm["b"], "pvp", chooser if chooser in ks else "-"] + ([mode if mode in ("ffa", "2hg") else "ffa"] if extra else [])
    sid, p, container = _spawn(data_dir, decks["a"], decks["b"], args, ai_b=False, extra=extra)
    blank = lambda: {"state": None, "prompt": None, "asks": {}, "log": [], "since": time.time(), "last": 0}  # noqa: E731
    with COND:
        S[sid] = {"owner": seats["a"], "seats": {k: seats[k] for k in ks}, "pv": {k: blank() for k in ks}, "afk": afk, "clock": clock,
                  "p": p, "container": container, "seq": 0, "state": None, "prompt": None, "asks": {}, "log": [],
                  "ended": False, "winner": None, "ts": time.time(), "names": {k: decks[k].get("name") for k in ks},
                  "players": nm, "rate": None, "arts": {k: sim.art_map(decks[k]) for k in ks}, "chooser": chooser in ks}
    threading.Thread(target=_reader, args=(sid, p), daemon=True).start()
    return sid


def _spawn(data_dir, deck, opp, args, ai_b, extra=()):
    """Arranca o GrimorioNet (contentor no servidor, Java local nos pacotes) com os dois decks -> (sid, processo, contentor)."""
    fdir = sim.forge_dir(data_dir)
    ext = os.path.join(os.path.dirname(os.path.realpath(fdir)), "forge-ext")  # ao lado do Forge (o build.sh põe-no lá)
    if not os.path.isfile(os.path.join(ext, "GrimorioNet.class")):
        raise ValueError("Falta compilar o GrimorioNet (build/forge/build.sh).")
    sid = uuid.uuid4().hex[:12]
    jdir = os.path.join(data_dir, "forge-run", f"net-{sid}")
    os.makedirs(os.path.join(jdir, "home"), exist_ok=True)
    names = sim.forge_names(fdir, os.path.join(data_dir, "forge-run"))
    for side, d in (("a", deck), ("b", opp)):
        txt, _ = sim.to_dck(d, side.upper(), "Constructed", names, ai=ai_b and side == "b")  # o meu deck (a) fica como está; na mesa estrita os dois
        with open(os.path.join(jdir, f"{side}.dck"), "w", encoding="utf-8") as f:
            f.write(txt)
    for side, d, _ in extra:  # mesa estrita a 3–4: os lugares c e d
        txt, _ = sim.to_dck(d, side.upper(), "Constructed", names, ai=False)
        with open(os.path.join(jdir, f"{side}.dck"), "w", encoding="utf-8") as f:
            f.write(txt)
    jvm = ["-Xmx2g", "-Djava.awt.headless=true", "-Dfile.encoding=UTF-8"]
    container = None
    if sim.RUNTIME == "local":
        cmd = [sim.JAVA, *jvm, f"-Duser.home={os.path.join(jdir, 'home')}", "-cp", os.pathsep.join([ext, os.path.join(fdir, sim.FORGE_JAR)]),
               "GrimorioNet", os.path.join(jdir, "a.dck"), os.path.join(jdir, "b.dck"), *args, *(f"{os.path.join(jdir, k + '.dck')}|{n}" for k, _, n in extra)]
        p = subprocess.Popen(cmd, cwd=fdir, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=open(os.path.join(jdir, "err.log"), "wb"))
    else:
        container = f"{sim.PREFIX}net-{sid}"
        cmd = ["docker", "run", "--rm", "-i", "--name", container, "-m", "3g", "--cpus", "2",
               "--user", f"{os.getuid()}:{os.getgid()}", "-e", "HOME=/run/home",
               "-v", f"{fdir}:/forge:ro", "-v", f"{jdir}:/run", "-w", "/forge"]
        for sub, dst in (("ai", "/forge/res/ai"), ("cardsfolder", "/forge/res/cardsfolder")):
            if os.path.isdir(os.path.join(ext, sub)):
                cmd += ["-v", f"{os.path.join(ext, sub)}:{dst}:ro"]
        cmd += ["-v", f"{ext}:/ext:ro", sim.IMAGE, "java", *jvm, "-cp", f"/ext:{sim.FORGE_JAR}", "GrimorioNet",
                "/run/a.dck", "/run/b.dck", *args, *(f"/run/{k}.dck|{n}" for k, _, n in extra)]
        p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=open(os.path.join(jdir, "err.log"), "wb"))
    return sid, p, container


def _get(sid, owner):
    s = S.get(sid)
    if not s or (s["owner"] != owner and owner not in (s.get("seats") or {}).values()):
        raise KeyError(sid)
    return s


def _seat(s, owner):
    """Mesa estrita: o lugar de quem pede ('a' ou 'b'); None num jogo contra o Forge."""
    return next((k for k, o in (s.get("seats") or {}).items() if o == owner), None)


def _afk(s):
    """Mesa estrita: quem deve uma decisão (escolha pendente ou o jogo à espera dele) e não mexe há AFK s desiste."""
    if not s.get("pv") or s["ended"]:
        return
    now = time.time()
    for k, v in s["pv"].items():
        owes = bool(v["asks"]) or (v["state"] is not None and not v["state"].get("waitme"))
        if owes and now - max(v.get("since", now), v.get("last", 0)) > s.get("afk", AFK) and not v.get("gone"):
            v["gone"] = True
            try:
                s["p"].stdin.write((json.dumps({"c": "concede", "seat": k}) + "\n").encode())
                s["p"].stdin.flush()
            except (BrokenPipeError, OSError):
                pass


def poll(sid, owner, since=0, wait=20.0):
    """Espera até haver novidades (seq > since) ou `wait` segundos; devolve o retrato atual."""
    end = time.time() + max(0.0, min(30.0, wait))
    with COND:
        s = _get(sid, owner)
        _afk(s)
        while s["seq"] <= since and not s["ended"] and time.time() < end:
            COND.wait(timeout=end - time.time())
        seat = _seat(s, owner)
        v = s["pv"][seat] if seat else s
        # o browser assume «a = eu» e os outros pela ordem dos lugares a seguir a mim: roda os nomes, as artes e as derrotas
        ks = list(s.get("seats") or {}) or ["a", "b"]
        rot = ks[ks.index(seat):] + ks[:ks.index(seat)] if seat in ks else ks
        sw = (lambda d: {"abcd"[i]: (d or {}).get(k) for i, k in enumerate(rot)} if d else d) if seat and seat != "a" else (lambda d: d)
        out = s.get("out")
        return {"seq": s["seq"], "state": v["state"], "prompt": v["prompt"], "asks": list(v["asks"].values()), "log": v["log"][-12:],
                "ended": s["ended"], "winner": s["winner"], "names": sw(s["names"]), "crash": bool(s.get("crash")), "chooser": bool(s.get("chooser")),
                "arts": sw(s.get("arts")), "out": sw(out) if isinstance(out, dict) and set(out) <= set("abcd") else out, "draw": s.get("draw", False),
                **({"pvp": {"seat": seat, "afk": s.get("afk", AFK), "clock": s.get("clock")}} if seat else {})}


def cmd(sid, owner, c):
    if not isinstance(c, dict) or c.get("c") not in OK_CMDS:
        raise ValueError("Comando desconhecido.")
    with COND:
        s = _get(sid, owner)
        seat = _seat(s, owner)
        v = s["pv"][seat] if seat else s
        if c["c"] == "answer":
            v["asks"].pop(c.get("id"), None)
        s["ts"] = v["last"] = time.time()
        p = s["p"]
    try:
        p.stdin.write((json.dumps({**{k: c[k] for k in ("c", "id", "i", "v", "color", "ab") if k in c}, **({"seat": seat} if seat else {})}) + "\n").encode())
        p.stdin.flush()
    except (BrokenPipeError, OSError):
        raise ValueError("O jogo já acabou.")


def result(sid):
    """Para os torneios: None se o jogo já não existe; senão {ended, side ('a' = tu, 'b' = a IA, None), turns}."""
    with COND:
        s = S.get(sid)
        if not s:
            return None
        st = s["state"] or (s.get("pv") or {}).get("a", {}).get("state") or {}
        return {"ended": s["ended"], "side": s.get("side"), "turns": st.get("turn"), "snaps": list(s.get("snaps") or [])}


def stop(sid, owner):
    with COND:
        s = _get(sid, owner)
        seat = _seat(s, owner)
        if not seat:
            S.pop(sid, None)
    if seat:  # mesa estrita: sair é desistir (o jogo acaba para os dois e o processo sai sozinho)
        if not s["ended"]:
            cmd(sid, owner, {"c": "concede"})
        return
    _kill(s)


def kill(sid):
    """Torneios/limpeza: fecha o jogo de vez (mesa estrita incluída)."""
    with COND:
        s = S.pop(sid, None)
    if s:
        _kill(s)


def running():
    """Jogos a decorrer (cada um ~1 GB): os torneios contam-nos como lugares do simulador."""
    with COND:
        return sum(1 for s in S.values() if not s["ended"])


def active(owner):
    with COND:
        return [{"id": k, "ended": s["ended"], "names": s["names"], **({"pvp": True} if s.get("seats") else {})} for k, s in S.items() if s["owner"] == owner or owner in (s.get("seats") or {}).values()]


def selfcheck():
    """O protocolo do lado do servidor, com um processo falso no lugar do Forge."""
    import sys
    fake = ("import sys,json\n"
            "print('lixo de arranque');print('@@GN '+json.dumps({'t':'open'}),flush=True)\n"
            "print('@@GN '+json.dumps({'t':'prompt','msg':'keep?','buttons':[{'label':'Keep','on':True,'c':'ok'}]}),flush=True)\n"
            "print('@@GN '+json.dumps({'t':'ask','id':1,'kind':'choose','min':1,'max':1,'options':[{'label':'x'}]}),flush=True)\n"
            "for l in sys.stdin:\n  c=json.loads(l)\n  print('@@GN '+json.dumps({'t':'state','turn':1,'got':c['c']}),flush=True)\n"
            "  if c['c']=='concede': print('@@GN '+json.dumps({'t':'end','winner':'IA'}),flush=True); break\n")
    p = subprocess.Popen([sys.executable, "-c", fake], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    with COND:
        S["t1"] = {"owner": "o", "p": p, "container": None, "seq": 0, "state": None, "prompt": None, "asks": {}, "log": [],
                   "ended": False, "winner": None, "ts": time.time(), "names": {}}
    threading.Thread(target=_reader, args=("t1", p), daemon=True).start()
    r = poll("t1", "o", 0, 5)
    while len(r["asks"]) < 1 and not r["ended"]:
        r = poll("t1", "o", r["seq"], 5)
    assert r["prompt"]["msg"] == "keep?" and r["asks"][0]["id"] == 1, r
    cmd("t1", "o", {"c": "answer", "id": 1, "v": [0]})
    r = poll("t1", "o", r["seq"], 5)
    assert r["state"]["got"] == "answer" and not r["asks"], r
    try:
        poll("t1", "outro")
        raise AssertionError("outro dono não pode ver o jogo")
    except KeyError:
        pass
    try:
        cmd("t1", "o", {"c": "rm -rf"})
        raise AssertionError("comando desconhecido devia falhar")
    except ValueError:
        pass
    cmd("t1", "o", {"c": "concede"})
    r = poll("t1", "o", r["seq"], 5)
    while not r["ended"]:
        r = poll("t1", "o", r["seq"], 5)
    assert r["winner"] == "IA" and result("t1")["ended"]
    stop("t1", "o")
    # fim pelo estado («over») e depois a mensagem «end»: os ratings recebem o jogo uma vez só, com o lado certo
    global ON_END
    got, ON_END = [], lambda rate, side: got.append((rate, side))
    fake2 = ("import json\nfor m in [{'t':'state','turn':3,'over':True,'winner':'Tu'},{'t':'end','winner':'Tu'}]:\n"
             "  print('@@GN '+json.dumps(m),flush=True)\n")
    p = subprocess.Popen([sys.executable, "-c", fake2], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    with COND:
        S["t2"] = {"owner": "o", "p": p, "container": None, "seq": 0, "state": None, "prompt": None, "asks": {}, "log": [],
                   "ended": False, "winner": None, "ts": time.time(), "names": {}, "players": {"a": "Tu", "b": "IA"}, "rate": {"deck_id": "d"}}
    _reader("t2", p)
    assert got == [({"deck_id": "d"}, "a")] and result("t2")["side"] == "a", got
    S["t2"]["rate"], S["t2"]["rated"] = {"x": 1}, False  # parado a meio (sem vencedor): o fim do processo não conta
    S["t3"] = {**S["t2"], "ended": False, "side_set": False, "winner": None, "side": None, "seq": 0}
    p = subprocess.Popen([sys.executable, "-c", "pass"], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    S["t3"]["p"] = p
    _reader("t3", p)
    assert len(got) == 1 and result("t3")["ended"] and result("t3")["side"] is None
    # a thread do jogo do Forge morreu (watchdog do GrimorioNet): acaba sem vencedor e o browser sabe porquê
    S["t4"] = {**S["t3"], "ended": False, "seq": 0, "crash": False}
    p = subprocess.Popen([sys.executable, "-c", "print('@@GN {\"t\":\"crash\"}',flush=True)"], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    S["t4"]["p"] = p
    _reader("t4", p)
    assert result("t4")["ended"] and result("t4")["side"] is None and poll("t4", "o", 0, 1)["crash"] and len(got) == 1
    ON_END = None
    S.pop("t2", None), S.pop("t3", None), S.pop("t4", None)
    # mesa estrita: cada lugar só vê as suas escolhas; o b recebe os nomes trocados; comandos levam o lugar; sair = desistir
    fake5 = ("import sys,json\n"
             "for m in [{'t':'state','s':'a','turn':1,'waitme':False},{'t':'state','s':'b','turn':1,'waitme':True},{'t':'ask','s':'a','id':1,'kind':'choose'}]:\n"
             "  print('@@GN '+json.dumps(m),flush=True)\n"
             "for l in sys.stdin:\n  c=json.loads(l)\n  print('@@GN '+json.dumps({'t':'state','s':c.get('seat'),'got':c['c'],'waitme':True}),flush=True)\n"
             "  if c['c']=='concede': print('@@GN '+json.dumps({'t':'end','winner':'Ana'}),flush=True); break\n")
    p = subprocess.Popen([sys.executable, "-c", fake5], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    blank = lambda: {"state": None, "prompt": None, "asks": {}, "log": [], "since": time.time(), "last": 0}  # noqa: E731
    with COND:
        S["t5"] = {"owner": "h", "seats": {"a": "h", "b": "h~guest:ana"}, "pv": {"a": blank(), "b": blank()}, "afk": 300, "p": p, "container": None,
                   "seq": 0, "state": None, "prompt": None, "asks": {}, "log": [], "ended": False, "winner": None, "ts": time.time(),
                   "names": {"a": "Deck H", "b": "Deck A"}, "players": {"a": "Hubert", "b": "Ana"}, "arts": {"a": {"x": 1}, "b": {}}}
    threading.Thread(target=_reader, args=("t5", p), daemon=True).start()
    ra = poll("t5", "h", 0, 3)
    while len(ra["asks"]) < 1:
        ra = poll("t5", "h", ra["seq"], 3)
    rb = poll("t5", "h~guest:ana", 0, 1)
    assert ra["pvp"]["seat"] == "a" and rb["pvp"]["seat"] == "b" and not rb["asks"] and rb["state"]["waitme"], rb
    assert rb["names"] == {"a": "Deck A", "b": "Deck H"} and rb["arts"] == {"a": {}, "b": {"x": 1}}, rb
    try:
        poll("t5", "outro", 0, 0)
        raise AssertionError("quem não está sentado não vê a mesa estrita")
    except KeyError:
        pass
    cmd("t5", "h~guest:ana", {"c": "ok"})
    rb = poll("t5", "h~guest:ana", rb["seq"], 3)
    while (rb["state"] or {}).get("got") != "ok":
        rb = poll("t5", "h~guest:ana", rb["seq"], 3)
    stop("t5", "h~guest:ana")  # sair = desistir
    while not poll("t5", "h", 0, 1)["ended"]:
        pass
    assert result("t5")["side"] == "b" and "t5" in S
    kill("t5")
    print("selfcheck ok")


if __name__ == "__main__":
    selfcheck()
