"""Limitado: booster draft e selado com o motor do Forge (build/forge/GrimorioDraft.java).

O Forge abre os packs reais do set, os bots escolhem com a IA de draft dele e montam os decks de 40; aqui arranca-se
o processo (contentor no servidor, Java local nos pacotes), guarda-se o pack que está à tua frente e o browser lê por
pedidos de espera longa (`since`) e manda as escolhas. No fim fica um evento em <dados>/limited/<id>.json com o pool
e o deck de cada lugar (0 = tu), de onde saem o teu deck no Construir e o torneio.
"""
import json, os, re, subprocess, threading, time, uuid

import sim

S = {}                      # sessão -> {owner, p, container, seq, pack, ended, error, ts, ev}
COND = threading.Condition()
IDLE = 3600                 # um draft parado há mais de 1 h fecha-se (cada um prende um Forge com 2 GB)
CODE = re.compile(r"[A-Z0-9]{2,6}")
SETS_LOCK = threading.Lock()


def _java(data_dir, jdir, args, name):
    """O GrimorioDraft com os mesmos caminhos do Forge Play (playnet.py)."""
    fdir = sim.forge_dir(data_dir)
    ext = os.path.join(os.path.dirname(os.path.realpath(fdir)), "forge-ext")
    if not os.path.isfile(os.path.join(ext, "GrimorioDraft.class")):
        raise ValueError("Falta compilar o GrimorioDraft (build/forge/build.sh).")
    os.makedirs(os.path.join(jdir, "home"), exist_ok=True)
    jvm = ["-Xmx2g", "-Djava.awt.headless=true", "-Dfile.encoding=UTF-8"]
    err = open(os.path.join(jdir, "err.log"), "wb")
    if sim.RUNTIME == "local":
        cmd = [sim.JAVA, *jvm, f"-Duser.home={os.path.join(jdir, 'home')}", "-cp", os.pathsep.join([ext, os.path.join(fdir, sim.FORGE_JAR)]),
               "GrimorioDraft", *args]
        return subprocess.Popen(cmd, cwd=fdir, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=err), None
    container = f"{sim.PREFIX}draft-{name}"
    cmd = ["docker", "run", "--rm", "-i", "--name", container, "-m", "3g", "--cpus", "2",
           "--user", f"{os.getuid()}:{os.getgid()}", "-e", "HOME=/run/home", "-v", f"{fdir}:/forge:ro", "-v", f"{jdir}:/run", "-w", "/forge"]
    for sub, dst in (("ai", "/forge/res/ai"), ("cardsfolder", "/forge/res/cardsfolder")):
        if os.path.isdir(os.path.join(ext, sub)):
            cmd += ["-v", f"{os.path.join(ext, sub)}:{dst}:ro"]
    cmd += ["-v", f"{ext}:/ext:ro", sim.IMAGE, "java", *jvm, "-cp", f"/ext:{sim.FORGE_JAR}", "GrimorioDraft", *args]
    return subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=err), container


def _lines(p):
    for raw in p.stdout:
        line = raw.decode("utf-8", "replace").rstrip("\n")
        if line.startswith("@@GD "):
            try:
                yield json.loads(line[5:])
            except ValueError:
                pass


def sets(data_dir):
    """Os sets com boosters no Forge (do mais recente para o mais antigo); guardados até o Forge mudar."""
    fdir = sim.forge_dir(data_dir)
    stamp = str(os.stat(os.path.join(fdir, sim.FORGE_JAR)).st_mtime)
    cache = os.path.join(data_dir, "limited", "sets.json")
    with SETS_LOCK:
        try:
            with open(cache, encoding="utf-8") as f:
                c = json.load(f)
            if c.get("stamp") == stamp:
                return c["sets"]
        except (OSError, ValueError):
            pass
        jdir = os.path.join(data_dir, "forge-run", "draft-sets")
        p, _ = _java(data_dir, jdir, ["sets"], "sets-" + uuid.uuid4().hex[:6])
        try:
            out = next((m for m in _lines(p) if m.get("t") in ("sets", "error")), None)
        finally:
            p.kill()
        if not out or out["t"] != "sets":
            raise ValueError("O Forge não devolveu a lista de sets.")
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        with open(cache, "w", encoding="utf-8") as f:
            json.dump({"stamp": stamp, "sets": out["sets"]}, f)
        return out["sets"]


def _path(data_dir, eid):
    return os.path.join(data_dir, "limited", f"{eid}.json")


def load(data_dir, eid, owner):
    """O evento (pools e decks de cada lugar) se for deste dono."""
    if not re.fullmatch(r"[a-f0-9]{12}", str(eid or "")):
        raise KeyError(eid)
    try:
        with open(_path(data_dir, eid), encoding="utf-8") as f:
            ev = json.load(f)
    except (OSError, ValueError):
        raise KeyError(eid)
    if ev.get("owner") != owner:
        raise KeyError(eid)
    return ev


def save(data_dir, ev):
    os.makedirs(os.path.join(data_dir, "limited"), exist_ok=True)
    tmp = _path(data_dir, ev["id"]) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(ev, f, ensure_ascii=False)
    os.replace(tmp, _path(data_dir, ev["id"]))


def events(data_dir, owner, n=12):
    """Os meus eventos mais recentes (sem os pools, que são grandes)."""
    _cleanup()
    d = os.path.join(data_dir, "limited")
    out = []
    for fn in os.listdir(d) if os.path.isdir(d) else []:
        if re.fullmatch(r"[a-f0-9]{12}\.json", fn):
            try:
                with open(os.path.join(d, fn), encoding="utf-8") as f:
                    ev = json.load(f)
            except (OSError, ValueError):
                continue
            if ev.get("owner") == owner:
                if ev.get("status") == "drafting" and ev.get("id") not in S:  # o servidor reiniciou a meio: o draft perdeu-se
                    ev.update(status="error", error="O draft foi interrompido.")
                out.append({k: ev.get(k) for k in ("id", "kind", "sets", "human", "ts", "status", "deck_id", "tid", "error")})
    return sorted(out, key=lambda e: -(e["ts"] or 0))[:n]


def _reader(data_dir, eid, p):
    done = None
    for m in _lines(p):
        with COND:
            s = S.get(eid)
            if not s:
                break
            if m.get("t") == "pack":
                s["pack"] = m
            elif m.get("t") == "done":
                done = m
            elif m.get("t") == "error":
                s["error"] = m.get("msg") or "erro no Forge"
            s["seq"] += 1
            s["ts"] = time.time()
            COND.notify_all()
        if done:
            break
    with COND:
        s = S.get(eid)
        if not s:
            return
        ev = s["ev"]
        if done:
            ev.update(status="built", players=done["players"])
        else:
            ev.update(status="error", error=s["error"] or "O Forge parou a meio.")
        save(data_dir, ev)
        s.update(ended=True, pack=None)
        s["seq"] += 1
        COND.notify_all()
    try:
        p.kill()
    except Exception:
        pass


def start(data_dir, owner, kind, codes, human=True, players=8):
    """kind = draft (3 packs, 8 lugares) | sealed (6 packs por lugar, 2–16 lugares); codes = um set por pack."""
    _cleanup()
    if kind not in ("draft", "sealed"):
        raise ValueError("Modo desconhecido: draft ou selado.")
    codes = [str(c).upper() for c in (codes or [])]
    want = 3 if kind == "draft" else 6
    if len(codes) == 1:
        codes *= want
    if len(codes) != want or not all(CODE.fullmatch(c) for c in codes):
        raise ValueError(f"Escolhe o set (ou um set por pack: {want}).")
    known = {s["code"] for s in sets(data_dir)}
    if not set(codes) <= known:
        raise ValueError("Esse set não tem boosters no Forge.")
    with COND:
        for k in [k for k, s in S.items() if s["owner"] == owner and not s["ended"]]:
            _kill(S.pop(k))
    eid = uuid.uuid4().hex[:12]
    n = 8 if kind == "draft" else max(2, min(16, int(players or 8)))
    args = ["draft", ",".join(codes), "human" if human else "bots"] if kind == "draft" else \
        ["sealed", ",".join(codes), str(n), "human" if human else "bots"]
    p, container = _java(data_dir, os.path.join(data_dir, "forge-run", f"draft-{eid}"), args, eid)
    ev = {"id": eid, "owner": owner, "kind": kind, "sets": codes, "human": bool(human), "n": n, "ts": time.time(), "status": "drafting"}
    save(data_dir, ev)
    with COND:
        S[eid] = {"owner": owner, "p": p, "container": container, "seq": 0, "pack": None, "ended": False, "error": None,
                  "ts": time.time(), "ev": ev, "dir": data_dir}
    threading.Thread(target=_reader, args=(data_dir, eid, p), daemon=True).start()
    return eid


def poll(eid, owner, since=0, wait=20.0):
    end = time.time() + max(0.0, min(30.0, wait))
    with COND:
        s = S.get(eid)
        if not s or s["owner"] != owner:
            raise KeyError(eid)
        while s["seq"] <= since and not s["ended"] and time.time() < end:
            COND.wait(timeout=end - time.time())
        return {"seq": s["seq"], "pack": s["pack"], "ended": s["ended"], "error": s["error"] or s["ev"].get("error"),
                "status": s["ev"]["status"]}


def pick(eid, owner, i):
    with COND:
        s = S.get(eid)
        if not s or s["owner"] != owner:
            raise KeyError(eid)
        if not s["pack"] or not 0 <= int(i) < len(s["pack"]["cards"]):
            raise ValueError("Essa carta já não está no pack.")
        s["pack"], s["ts"] = None, time.time()  # até chegar o próximo
        p = s["p"]
    try:
        p.stdin.write((json.dumps({"pick": int(i)}) + "\n").encode())
        p.stdin.flush()
    except (BrokenPipeError, OSError):
        raise ValueError("O draft já acabou.")


def stop(eid, owner):
    with COND:
        s = S.get(eid)
        if not s or s["owner"] != owner:
            raise KeyError(eid)
        S.pop(eid, None)
        if not s["ended"]:
            s["ev"].update(status="error", error="Desististe do draft.")
            if s.get("dir"):
                save(s["dir"], s["ev"])
    _kill(s)


def _kill(s):
    try:
        s["p"].kill()
    except Exception:
        pass
    if s.get("container"):
        subprocess.run(["docker", "kill", s["container"]], capture_output=True)


def _cleanup():
    with COND:
        for k in [k for k, s in S.items() if time.time() - s["ts"] > IDLE or s["ended"] and time.time() - s["ts"] > 600]:
            _kill(S.pop(k))


BASIC_COLOR = {"Plains": "W", "Island": "U", "Swamp": "B", "Mountain": "R", "Forest": "G"}


def colors(ev, seat):
    """As cores de um deck do evento pelos básicos que leva (os decks de 40 do Forge levam sempre básicos)."""
    main = ev["players"][seat]["deck"].get("main") or {}
    return "".join(c for c in "WUBRG" if any(BASIC_COLOR.get(n) == c and q for n, q in main.items()))


def deck_of(ev, seat, name=None):
    """O deck de 40 de um lugar do evento, no formato do Grimório (cartas pelo nome)."""
    pl = ev["players"][seat]
    main = dict(pl["deck"].get("main") or {})
    left = {}
    for c in pl["pool"]:
        left[c["n"]] = left.get(c["n"], 0) + 1
    for n, q in main.items():
        if n in left:
            left[n] = max(0, left[n] - q)
    return {"name": name or f"Bot {seat} · {colors(ev, seat) or 'C'} ({'/'.join(dict.fromkeys(ev['sets']))})", "format": "limited",
            "main": main, "side": {n: q for n, q in left.items() if q}, "commanders": []}


def selfcheck():
    """O protocolo do lado do servidor com um processo falso no lugar do Forge."""
    import sys, tempfile
    d = tempfile.mkdtemp()
    fake = ("import sys,json\n"
            "print('@@GD '+json.dumps({'t':'pack','round':1,'rounds':3,'pick':1,'cards':[{'n':'A'},{'n':'B'}],'pool':[]}),flush=True)\n"
            "l=json.loads(sys.stdin.readline())\n"
            "pool=[{'n':'AB'[l['pick']]},{'n':'Plains'}]\n"
            "print('@@GD '+json.dumps({'t':'done','players':[{'seat':0,'pool':pool,'deck':{'main':{'Plains':1},'side':{}}}]}),flush=True)\n")
    p = subprocess.Popen([sys.executable, "-c", fake], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    ev = {"id": "0123456789ab", "owner": "o", "kind": "draft", "sets": ["TLA"] * 3, "human": True, "n": 8, "ts": time.time(), "status": "drafting"}
    with COND:
        S[ev["id"]] = {"owner": "o", "p": p, "container": None, "seq": 0, "pack": None, "ended": False, "error": None, "ts": time.time(), "ev": ev}
    threading.Thread(target=_reader, args=(d, ev["id"], p), daemon=True).start()
    r = poll(ev["id"], "o", 0, 5)
    assert r["pack"]["cards"][1]["n"] == "B", r
    try:
        poll(ev["id"], "outro", 0, 0)
        raise AssertionError("outro dono não pode ver o draft")
    except KeyError:
        pass
    try:
        pick(ev["id"], "o", 7)
        raise AssertionError("escolha fora do pack devia falhar")
    except ValueError:
        pass
    pick(ev["id"], "o", 1)
    while not r["ended"]:
        r = poll(ev["id"], "o", r["seq"], 5)
    got = load(d, ev["id"], "o")
    assert got["status"] == "built" and [c["n"] for c in got["players"][0]["pool"]] == ["B", "Plains"], got
    dk = deck_of(got, 0, "Meu draft")
    assert dk["main"] == {"Plains": 1} and dk["side"] == {"B": 1} and dk["format"] == "limited", dk
    assert events(d, "o")[0]["status"] == "built" and not events(d, "outro")
    assert colors(got, 0) == "W" and deck_of(got, 0)["name"] == "Bot 0 · W (TLA)", deck_of(got, 0)
    print("selfcheck ok")


if __name__ == "__main__":
    selfcheck()
