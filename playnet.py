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
            k = m.get("t")
            if k == "state":
                s["state"] = m
            elif k == "prompt":
                s["prompt"] = m
            elif k == "ask":
                s["asks"][m["id"]] = m
            elif k in ("msg", "flash"):
                s["log"] = (s["log"] + [m])[-40:]
            elif k == "end":
                s["ended"], s["winner"] = True, m.get("winner")
                pl = s.get("players") or {}
                s["side"] = next((k2 for k2, n in pl.items() if n and n == m.get("winner")), None)  # quem ganhou: a (tu) ou b
            s["seq"] += 1
            s["ts"] = time.time()
            COND.notify_all()
    with COND:
        if sid in S:
            S[sid]["ended"] = True
            S[sid]["seq"] += 1
            COND.notify_all()


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


def start(data_dir, owner, deck, opp, difficulty="default", name="Tu"):
    """deck/opp = {name, main, side, commanders}; devolve o id da sessão. Um jogo de cada vez por dono."""
    _cleanup()
    for d in (deck, opp):
        if not isinstance(d, dict) or not isinstance(d.get("main"), dict) or not d["main"]:
            raise ValueError("Falta um dos decks.")
        if d.get("commanders"):
            raise ValueError("O Forge Play é só para formatos 1 contra 1 (sem Commander).")
    with COND:
        for sid in [k for k, s in S.items() if s["owner"] == owner]:
            _kill(S.pop(sid))
    fdir = sim.forge_dir(data_dir)
    ext = os.path.join(os.path.dirname(os.path.realpath(fdir)), "forge-ext")  # ao lado do Forge (o build.sh põe-no lá)
    if not os.path.isfile(os.path.join(ext, "GrimorioNet.class")):
        raise ValueError("Falta compilar o GrimorioNet (build/forge/build.sh).")
    sid = uuid.uuid4().hex[:12]
    jdir = os.path.join(data_dir, "forge-run", f"net-{sid}")
    os.makedirs(os.path.join(jdir, "home"), exist_ok=True)
    names = sim.forge_names(fdir, os.path.join(data_dir, "forge-run"))
    for side, d in (("a", deck), ("b", opp)):
        txt, _ = sim.to_dck(d, side.upper(), "Constructed", names, ai=side == "b")  # o meu deck (a) fica como está
        with open(os.path.join(jdir, f"{side}.dck"), "w", encoding="utf-8") as f:
            f.write(txt)
    profs = {i: p for i, p, *_ in sim.DIFFICULTIES}
    prof = profs.get(difficulty) or "Default"
    oname = str(opp.get("name") or "Forge")[:40]
    jvm = ["-Xmx2g", "-Djava.awt.headless=true", "-Dfile.encoding=UTF-8"]
    container = None
    if sim.RUNTIME == "local":
        cmd = [sim.JAVA, *jvm, f"-Duser.home={os.path.join(jdir, 'home')}", "-cp", os.pathsep.join([ext, os.path.join(fdir, sim.FORGE_JAR)]),
               "GrimorioNet", os.path.join(jdir, "a.dck"), os.path.join(jdir, "b.dck"), str(name)[:40] or "Tu", prof, oname]
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
                "/run/a.dck", "/run/b.dck", str(name)[:40] or "Tu", prof, oname]
        p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=open(os.path.join(jdir, "err.log"), "wb"))
    with COND:
        S[sid] = {"owner": owner, "p": p, "container": container, "seq": 0, "state": None, "prompt": None, "asks": {}, "log": [],
                  "ended": False, "winner": None, "ts": time.time(), "names": {"a": deck.get("name"), "b": opp.get("name")},
                  "players": {"a": str(name)[:40] or "Tu", "b": oname}}
    threading.Thread(target=_reader, args=(sid, p), daemon=True).start()
    return sid


def _get(sid, owner):
    s = S.get(sid)
    if not s or s["owner"] != owner:
        raise KeyError(sid)
    return s


def poll(sid, owner, since=0, wait=20.0):
    """Espera até haver novidades (seq > since) ou `wait` segundos; devolve o retrato atual."""
    end = time.time() + max(0.0, min(30.0, wait))
    with COND:
        s = _get(sid, owner)
        while s["seq"] <= since and not s["ended"] and time.time() < end:
            COND.wait(timeout=end - time.time())
        return {"seq": s["seq"], "state": s["state"], "prompt": s["prompt"], "asks": list(s["asks"].values()), "log": s["log"][-12:],
                "ended": s["ended"], "winner": s["winner"], "names": s["names"]}


def cmd(sid, owner, c):
    if not isinstance(c, dict) or c.get("c") not in OK_CMDS:
        raise ValueError("Comando desconhecido.")
    with COND:
        s = _get(sid, owner)
        if c["c"] == "answer":
            s["asks"].pop(c.get("id"), None)
        s["ts"] = time.time()
        p = s["p"]
    try:
        p.stdin.write((json.dumps({k: c[k] for k in ("c", "id", "i", "v", "color") if k in c}) + "\n").encode())
        p.stdin.flush()
    except (BrokenPipeError, OSError):
        raise ValueError("O jogo já acabou.")


def result(sid):
    """Para os torneios: None se o jogo já não existe; senão {ended, side ('a' = tu, 'b' = a IA, None), turns}."""
    with COND:
        s = S.get(sid)
        if not s:
            return None
        return {"ended": s["ended"], "side": s.get("side"), "turns": (s["state"] or {}).get("turn")}


def stop(sid, owner):
    with COND:
        s = _get(sid, owner)
        S.pop(sid, None)
    _kill(s)


def active(owner):
    with COND:
        return [{"id": k, "ended": s["ended"], "names": s["names"]} for k, s in S.items() if s["owner"] == owner]


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
    print("selfcheck ok")


if __name__ == "__main__":
    selfcheck()
