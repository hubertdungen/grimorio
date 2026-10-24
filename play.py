"""Grimório — jogar contra a IA do Forge no browser.

Um contentor `grimorio-play` (build/play/) corre o Forge desktop num ecrã virtual (Xvnc, com o VNC num socket
unix na pasta da sessão, sem porta TCP) e o lançador GrimorioPlay abre logo o jogo com os dois decks. O browser
fala VNC por websocket com este servidor (/play/ws, mesma origem: funciona atrás do Caddy + Authelia) e a ponte
segue para o socket. O cliente é o noVNC (core/ em <data>/novnc, servido em /play/novnc/; página web/public/play.html).

Uma sessão de cada vez (pouca RAM: contentor com -m 2560m e -Xmx1500m). Pára ao fim de 20 min sem input do
jogador, quando se pede, ou quando o Forge fecha (o contentor é --rm).

from_state retoma uma posição de uma repetição: o estado vai para o formato GameState do Forge (o dos puzzles,
res/puzzle/*.pzl: humanlife=…, aibattlefield=Carta|Tapped|Counters:P1P1=2;…) e o lado escolhido fica com o humano.
"""
import base64, glob, hashlib, os, re, shutil, socket, struct, subprocess, threading, time, uuid
import sim

IMAGE, NAME = "grimorio-play:latest", "grimorio-play"
MEM, XMX, GEOMETRY = "2560m", "1500m", "1600x900"
IDLE = 20 * 60  # s sem input do browser -> pára
# fase da app -> do Forge. "combat" com atacantes vai para a declaração de atacantes (como os puzzles; o Forge
# cria o combate com as criaturas marcadas Attacking); sem atacantes volta ao MAIN1 (COMBAT_BEGIN sem combate rebenta).
PHASE = {"untap": "UPKEEP", "upkeep": "UPKEEP", "draw": "DRAW", "main1": "MAIN1", "combat": "MAIN1",
         "main2": "MAIN2", "end": "END_OF_TURN"}
WS_GUID = b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
S = {}  # a sessão: {id, owner, started, active, title, warnings, run}
LOCK = threading.Lock()


OFF = "Jogar contra o Forge precisa do Docker (ecrã virtual + noVNC); nesta instalação sem Docker não está disponível. " \
      "Os testes, torneios e a Arena no Coliseu funcionam na mesma."


def _docker(*a):
    if sim.RUNTIME != "docker":  # pacotes Windows/Linux sem Docker: sem jogo com ecrã (OFF)
        return subprocess.CompletedProcess(a, 1, "", OFF)
    return subprocess.run(["docker", *a], capture_output=True, text=True)


def _alive():
    return _docker("inspect", "-f", "{{.State.Running}}", NAME).stdout.strip() == "true"


def _paths(data_dir):
    root = os.path.join(data_dir, "forge-play")
    return os.path.join(root, "run"), os.path.join(root, "home")


def init(data_dir):
    """Arranque do servidor: adota um jogo que ficou a correr (o servidor reiniciou a meio)."""
    if _alive():
        S.update({"id": "adotada", "owner": "", "started": time.time(), "active": time.time(), "title": "Jogo em curso",
                  "warnings": [], "run": _paths(data_dir)[0]})
        threading.Thread(target=_watch, args=("adotada",), daemon=True).start()


def check_deck(d, label):
    if not isinstance(d, dict) or not isinstance(d.get("main"), dict) or not d["main"]:
        raise ValueError(f"Falta o deck {label}.")
    for sec in ("main", "side"):
        v = d.get(sec) or {}
        if not isinstance(v, dict) or len(v) > 300 or any(
                not isinstance(n, str) or len(n) > 200 or not isinstance(q, int) or not 0 <= q <= 250 for n, q in v.items()):
            raise ValueError(f"Deck {label}: lista inválida.")
    return d


def _prefs(home, values):
    """Acrescenta/atualiza chaves em ~/.forge/preferences/forge.preferences (o resto do que o Forge guardou fica)."""
    path = os.path.join(home, ".forge", "preferences", "forge.preferences")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    lines = open(path, encoding="utf-8").read().splitlines() if os.path.isfile(path) else []
    lines = [l for l in lines if l.split("=", 1)[0] not in values]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines + [f"{k}={v}" for k, v in values.items()]) + "\n")


def _safe(name):
    return re.sub(r"\s+", " ", re.sub(r"[^\w .,'()&+—–-]", "", name)).strip()[:80] or "Deck"


def _launch(data_dir, owner, difficulty, args, files, title, warnings):
    """Pára a sessão anterior, escreve os ficheiros e arranca o contentor.
    args: os do GrimorioPlay (<humano.dck|-> <ia.dck|-> <tipo> <nomeHumano> <nomeIA> [estado]);
    files: {"home/…" ou "run/…": texto}."""
    prof = {d[0]: d[1] for d in sim.DIFFICULTIES}.get(difficulty or "default")
    if not prof:
        raise ValueError("Dificuldade desconhecida.")
    if any(j["status"] == "running" for j in list(sim.JOBS.values())):
        raise RuntimeError("O Laboratório está a correr testes no Forge; espera que acabem (a RAM não chega para os dois).")
    ext = os.path.join(data_dir, "forge-play-ext")
    if not os.path.isfile(os.path.join(ext, "GrimorioPlay.class")):
        raise RuntimeError("Falta preparar o Forge com ecrã: corre build/play/build.sh.")
    with LOCK:
        if S and S["owner"] not in ("", owner) and _alive():
            raise RuntimeError("Já há um jogo a decorrer (de outro utilizador).")
        stop()
        run, home = _paths(data_dir)
        shutil.rmtree(run, ignore_errors=True)
        os.makedirs(run)
        for sub in ("constructed", "commander"):  # os decks desta sessão substituem os da anterior
            shutil.rmtree(os.path.join(home, ".forge", "decks", sub), ignore_errors=True)
        os.makedirs(os.path.join(home, ".cache", "forge"), exist_ok=True)  # imagens das cartas: ficam entre sessões
        _prefs(home, {"UI_CURRENT_AI_PROFILE": prof, "PLAYER_NAME": args[3],
                      "UI_ENABLE_SOUNDS": "false", "UI_ENABLE_MUSIC": "false"})
        for rel, txt in files.items():
            top, sub = rel.split("/", 1)
            p = os.path.join(run if top == "run" else home, sub)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w", encoding="utf-8") as f:
                f.write(txt)
        r = _docker("run", "-d", "--rm", "--name", NAME, "-m", MEM, "--memory-swap", MEM, "--cpus", "2",
                    "--user", f"{os.getuid()}:{os.getgid()}", "-e", "HOME=/run/home", "-e", f"XMX={XMX}",
                    "-e", f"GEOMETRY={GEOMETRY}", "-e", f"FORGE_JAR={sim.FORGE_JAR}",
                    "-v", f"{os.path.join(data_dir, 'forge')}:/forge:ro", "-v", f"{ext}:/ext:ro",
                    "-v", f"{run}:/run", "-v", f"{home}:/run/home", IMAGE, *args)
        if r.returncode:
            raise RuntimeError("O contentor do Forge não arrancou: " + (r.stderr.strip()[-300:] or "erro desconhecido"))
        sid = uuid.uuid4().hex[:12]
        S.update({"id": sid, "owner": owner, "started": time.time(), "active": time.time(), "title": title,
                  "warnings": warnings, "run": run})
        threading.Thread(target=_watch, args=(sid,), daemon=True).start()
        return {"session": sid, "url": "play.html", "title": title, "warnings": warnings}


def _watch(sid):
    """Pára a sessão sem input há IDLE s; esquece-a quando o Forge fecha."""
    while True:
        time.sleep(15)
        with LOCK:
            if S.get("id") != sid:
                return
            if not _alive():
                S.clear()
                return
            if time.time() - S["active"] > IDLE:
                stop()
                return


def stop():
    """Pára o contentor, se houver, e espera que desapareça (--rm) para o nome ficar livre."""
    if _docker("ps", "-aq", "-f", f"name=^{NAME}$").stdout.strip():
        _docker("kill", NAME)
        for _ in range(40):
            if not _docker("ps", "-aq", "-f", f"name=^{NAME}$").stdout.strip():
                break
            time.sleep(0.25)
    S.clear()
    return {"ok": True}


def status():
    alive = bool(S) and _alive()
    if S and not alive:
        S.clear()
    out = {"running": alive, **({} if sim.RUNTIME == "docker" else {"unavailable": OFF})}
    if alive:
        out.update({k: S[k] for k in ("id", "owner", "started", "title", "warnings")})
        out.update(idle=int(time.time() - S["active"]), idle_limit=IDLE)
        r = _docker("stats", "--no-stream", "--format", "{{.MemUsage}}|{{.CPUPerc}}", NAME).stdout.strip()
        if "|" in r:
            out["mem"], out["cpu"] = r.split("|", 1)
    return out


# ---------- jogo novo ----------

def start(data_dir, body, owner):
    """body: {a: o teu deck, b: o adversário, format, difficulty} (os ids já vêm resolvidos pelo server.py)."""
    if sim.RUNTIME != "docker":
        raise RuntimeError(OFF)
    fmt = str(body.get("format") or "modern").lower()
    gtype = sim.GAME_TYPE.get(fmt, "Constructed")
    a, b = check_deck(body.get("a"), "teu"), check_deck(body.get("b"), "adversário")
    for d, label in ((a, "teu"), (b, "adversário")):
        if gtype != "Constructed" and not d.get("commanders"):
            raise ValueError(f"Deck {label}: falta o comandante.")
    names = sim.forge_names(sim.forge_dir(data_dir), os.path.join(data_dir, "forge-run"))
    folder = "constructed" if gtype == "Constructed" else "commander"
    na, nb = _safe(a.get("name") or "O meu deck"), _safe(b.get("name") or "Adversário")
    if nb == na:
        nb += " (adversário)"
    files, warnings = {}, []
    for d, n in ((a, na), (b, nb)):
        txt, unk = sim.to_dck(d, n, gtype, names)
        warnings += [f"{n}: o Forge não conhece «{u}» (fica de fora)" for u in unk]
        files[f"home/.forge/decks/{folder}/{n}.dck"] = txt
    args = [f"/run/home/.forge/decks/{folder}/{na}.dck", f"/run/home/.forge/decks/{folder}/{nb}.dck", gtype,
            owner or "Jogador", f"Forge ({nb})"]
    return _launch(data_dir, owner, body.get("difficulty"), args, files, f"{na} contra {nb}", warnings)


# ---------- retomar uma posição ----------

_tokens = None


def token_script(forge_dir, name, pt, kw):
    """Ficha da app ("Soldier Token", "1/1", ["Flying"]) -> script do Forge (res/tokenscripts, ex. w_1_1_soldier)."""
    global _tokens
    if _tokens is None:
        idx = {}
        for p in sorted(glob.glob(os.path.join(forge_dir, "res", "tokenscripts", "*.txt"))):
            with open(p, encoding="utf-8", errors="replace") as f:
                txt = f.read()
            m = re.search(r"^Name:(.+?)\s*$", txt, re.M)
            if m:
                ptm = re.search(r"^PT:(\S+)", txt, re.M)
                kws = {k.lower() for k in re.findall(r"^K:([A-Za-z ]+)", txt, re.M)}
                idx.setdefault(sim.fold(m.group(1)), []).append((os.path.basename(p)[:-4], ptm.group(1) if ptm else None, kws))
        _tokens = idx
    cands = _tokens.get(sim.fold(name)) or _tokens.get(sim.fold(name + " Token")) or []
    want = {k.lower() for k in kw or []}
    # mesmo P/R primeiro, depois as palavras-chave mais parecidas, depois o script mais simples (nome mais curto)
    return min(cands, key=lambda c: ((c[1] != pt) * 10 if pt else 0) + len(c[2] ^ want) + len(c[0]) * 0.01)[0] if cands else None


def _ctr(k):
    """Marcador da app -> CounterType do Forge: +1/+1 -> P1P1, -1/-1 -> M1M1, +1/+0 -> P1P0, loyalty -> LOYALTY."""
    m = re.fullmatch(r"([+-])(\d+)/([+-])(\d+)", k)
    if m:
        return ("P" if m[1] == "+" else "M") + m[2] + ("P" if m[3] == "+" else "M") + m[4]
    return re.sub(r"[^A-Z0-9_]", "", k.upper())


def _int(v, lo, hi, default):
    try:
        return max(lo, min(hi, int(v)))
    except (TypeError, ValueError):
        return default


def _names(v):
    return [n for n in (v or [])[:300] if isinstance(n, str) and 0 < len(n) <= 200]


def state_lines(st, control, names, forge_dir, warnings):
    """Estado da repetição (forgeState.js) -> linhas GameState do Forge, com o lado `control` como «human»."""
    other = "b" if control == "a" else "a"
    active = st.get("active") if st.get("active") in ("a", "b") else control
    bfs = {k: [p for p in ((st.get(k) or {}).get("battlefield") or [])[:300] if isinstance(p, dict)] for k in "ab"}
    attack = st.get("phase") == "combat" and any(p.get("attacking") for p in bfs[active])
    lines = [f"turn={_int(st.get('turn'), 1, 999, 1)}", f"activeplayer={'human' if active == control else 'ai'}",
             f"activephase={'COMBAT_DECLARE_ATTACKERS' if attack else PHASE.get(st.get('phase'), 'MAIN1')}"]
    present = {p.get("id") for k in "ab" for p in bfs[k] if p.get("id") is not None}
    attached = {p.get("attachedTo") for k in "ab" for p in bfs[k]} & present
    ids = {}

    def fname(n):
        f = sim.to_forge(n, names)
        if f is None:
            warnings.append(f"o Forge não conhece «{n}» (fica de fora)")
        return f

    def perm(p, side):
        name = p.get("name")
        if not isinstance(name, str) or not name or len(name) > 200:
            return None
        if p.get("token"):
            pt = p.get("pt") if isinstance(p.get("pt"), str) else None
            kw = _names(p.get("kw"))
            scr = token_script(forge_dir, name, pt, kw)
            if scr:
                spec = f"T:{scr}"
            else:  # ficha sem script: criada à mão (sem habilidades além das palavras-chave)
                base = re.sub(r"[,;|]", "", re.sub(r"\s*Token$", "", name))
                pw, tg = (pt.split("/") + ["0"])[:2] if pt else ("0", "0")
                spec = (f"t:{base} Token,P:{_int(pw, 0, 99, 0)},T:{_int(tg, 0, 99, 0)},"
                        f"Types:{'Creature-' + '-'.join(base.split()) if pt else 'Artifact'}"
                        + (",Keywords:" + "-".join(re.sub(r"[,;|-]", "", k) for k in kw) if kw else ""))
        else:
            spec = fname(name)
            if spec is None:
                return None
        flags = []
        if p.get("tapped"):
            flags.append("Tapped")
        if p.get("sick"):
            flags.append("SummonSick")
        if p.get("flipped"):
            flags.append("Transformed")
        if p.get("commander"):
            flags.append("IsCommander")
        ctr = {_ctr(k): _int(n, 0, 999, 0) for k, n in (p.get("counters") or {}).items() if isinstance(k, str)}
        ctr = {k: n for k, n in ctr.items() if k and n}
        if ctr:
            flags.append("Counters:" + ",".join(f"{k}={n}" for k, n in ctr.items()))
        if _int(p.get("damage"), 0, 999, 0):
            flags.append(f"Damage:{_int(p.get('damage'), 0, 999, 0)}")
        if p.get("id") is not None and p.get("id") in attached:
            flags.append(f"Id:{ids.setdefault(p['id'], len(ids) + 1)}")
        if attack and side == active and p.get("attacking"):
            flags.append("Attacking")  # ataca o jogador (planeswalkers atacados não passam)
        if p.get("attachedTo") in attached:
            flags.append(f"AttachedTo:{ids.setdefault(p['attachedTo'], len(ids) + 1)}")
        return "|".join([spec, *flags])

    for side, who in ((control, "human"), (other, "ai")):
        s = st.get(side) or {}
        lines.append(f"{who}life={_int(s.get('life'), -99, 999, 20)}")
        pc = {"POISON": _int(s.get("poison"), 0, 99, 0), "ENERGY": _int(s.get("energy"), 0, 999, 0)}
        if any(pc.values()):
            lines.append(f"{who}counters=" + ",".join(f"{k}={n}" for k, n in pc.items() if n))
        for zone in ("hand", "graveyard", "exile", "library"):
            cards = [f for f in (fname(n) for n in _names(s.get(zone))) if f]
            lines.append(f"{who}{zone}=" + ";".join(cards))
        cmd = [f + "|IsCommander" for f in (fname(n) for n in _names(s.get("command"))) if f]
        if cmd:
            lines.append(f"{who}command=" + ";".join(cmd))
        bf = [x for x in (perm(p, side) for p in bfs[side]) if x]
        lines.append(f"{who}battlefield=" + ";".join(bf))
        casts = {fname(c.get("name")): _int(c.get("casts"), 0, 99, 0) for c in (s.get("commanders") or [])
                 if isinstance(c, dict) and isinstance(c.get("name"), str)}
        casts = {k: n for k, n in casts.items() if k and n}
        if casts:
            lines.append(f"{who}commandercasts=" + ";".join(f"{k}={n}" for k, n in casts.items()))
    return lines


def from_state(data_dir, body, owner):
    """body: {state: {a, b, turn, active, phase}, control: 'a'|'b', format, difficulty} (ver web/src/forgeState.js)."""
    if sim.RUNTIME != "docker":
        raise RuntimeError(OFF)
    st, control = body.get("state"), body.get("control")
    if not isinstance(st, dict) or not isinstance(st.get("a"), dict) or not isinstance(st.get("b"), dict):
        raise ValueError("Falta o estado do jogo.")
    if control not in ("a", "b"):
        raise ValueError("Escolhe o lado que vais controlar (a ou b).")
    fmt = str(body.get("format") or "modern").lower()
    gtype = sim.GAME_TYPE.get(fmt, "Constructed")
    names = sim.forge_names(sim.forge_dir(data_dir), os.path.join(data_dir, "forge-run"))
    warnings = []
    lines = state_lines(st, control, names, sim.forge_dir(data_dir), warnings)
    warnings = list(dict.fromkeys(warnings))
    title = f"Posição do turno {_int(st.get('turn'), 1, 999, 1)}"
    args = ["-", "-", gtype, owner or "Jogador", "Forge", "/run/state.txt"]
    return _launch(data_dir, owner, body.get("difficulty"), args, {"run/state.txt": "\n".join(lines) + "\n"}, title, warnings)


# ---------- websocket (browser) <-> VNC (socket unix do contentor) ----------

def ws_bridge(h):
    """h: o BaseHTTPRequestHandler com o pedido «Upgrade: websocket». Bloqueia a thread até um dos lados fechar."""
    key = h.headers.get("Sec-WebSocket-Key")
    if "websocket" not in (h.headers.get("Upgrade") or "").lower() or not key:
        return h.send(400, b"so websocket", "text/plain")
    sid, run = S.get("id"), S.get("run")
    if not sid:
        return h.send(503, b"sem jogo", "text/plain")
    vnc = socket.socket(socket.AF_UNIX)
    try:
        vnc.connect(os.path.join(run, "vnc.sock"))
    except OSError:
        vnc.close()
        return h.send(503, b"o Forge ainda esta a arrancar", "text/plain")
    h.send_response(101, "Switching Protocols")
    h.send_header("Upgrade", "websocket")
    h.send_header("Connection", "Upgrade")
    h.send_header("Sec-WebSocket-Accept", base64.b64encode(hashlib.sha1(key.encode() + WS_GUID).digest()).decode())
    if "binary" in [p.strip() for p in (h.headers.get("Sec-WebSocket-Protocol") or "").split(",")]:
        h.send_header("Sec-WebSocket-Protocol", "binary")
    h.end_headers()
    h.close_connection = True
    conn, wlock = h.connection, threading.Lock()

    def send(op, data):
        n = len(data)
        hdr = bytes([0x80 | op]) + (bytes([n]) if n < 126 else bytes([126]) + struct.pack(">H", n) if n < 65536
                                    else bytes([127]) + struct.pack(">Q", n))
        with wlock:
            conn.sendall(hdr + data)

    def vnc_to_browser():
        try:
            while d := vnc.recv(262144):
                send(2, d)
        except OSError:
            pass
        try:
            conn.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass

    threading.Thread(target=vnc_to_browser, daemon=True).start()
    rf = h.rfile
    try:
        while len(b := rf.read(2)) == 2:
            op, n = b[0] & 0x0F, b[1] & 0x7F
            if n == 126:
                n = struct.unpack(">H", rf.read(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", rf.read(8))[0]
            if n > 1 << 20:
                break
            mask = rf.read(4) if b[1] & 0x80 else None
            data = rf.read(n)
            if mask and n:
                data = (int.from_bytes(data, "big") ^ int.from_bytes((mask * (n // 4 + 1))[:n], "big")).to_bytes(n, "big")
            if op == 8:
                send(8, data[:2])
                break
            if op == 9:
                send(10, data)
            elif op in (0, 1, 2):
                vnc.sendall(data)
                if S.get("id") == sid:
                    S["active"] = time.time()
    except (OSError, ValueError, struct.error):
        pass
    finally:
        vnc.close()


def selfcheck():
    names = {sim.fold(n): n for n in ("Lightning Bolt", "Grizzly Bears", "Rancor", "Atraxa, Praetors' Voice", "Forest")}
    st = {"turn": 5, "active": "b", "phase": "main1",
          "a": {"life": 14, "poison": 2, "hand": ["Lightning Bolt"], "library": ["Forest", "Forest"], "graveyard": [], "exile": [],
                "command": [], "commanders": [{"name": "Atraxa, Praetors' Voice", "casts": 2}],
                "battlefield": [{"id": 1, "name": "Grizzly Bears", "tapped": True, "counters": {"+1/+1": 2}, "damage": 1},
                                {"id": 2, "name": "Rancor", "attachedTo": 1},
                                {"id": 3, "name": "Atraxa, Praetors' Voice", "commander": True},
                                {"id": 4, "name": "Carta Inventada"}, {"id": 5, "name": "Rancor", "attachedTo": 99}]},
          "b": {"life": 20, "hand": [], "library": [], "battlefield": []}}
    w = []
    lines = state_lines(st, "b", names, "/nao/existe", w)
    assert lines[:3] == ["turn=5", "activeplayer=human", "activephase=MAIN1"], lines
    assert "aibattlefield=Grizzly Bears|Tapped|Counters:P1P1=2|Damage:1|Id:1;Rancor|AttachedTo:1;" \
           "Atraxa, Praetors' Voice|IsCommander;Rancor" in lines, lines  # anexo a uma carta fora de jogo: fica solto
    assert "aicounters=POISON=2" in lines and "aicommandercasts=Atraxa, Praetors' Voice=2" in lines, lines
    assert "aihand=Lightning Bolt" in lines and "humanlife=20" in lines, lines
    assert w == ["o Forge não conhece «Carta Inventada» (fica de fora)"], w
    st.update(phase="combat")
    st["b"]["battlefield"] = [{"id": "x", "name": "Grizzly Bears", "attacking": "a", "tapped": True}]
    lines = state_lines(st, "b", names, "/nao/existe", [])
    assert "activephase=COMBAT_DECLARE_ATTACKERS" in lines and "humanbattlefield=Grizzly Bears|Tapped|Attacking" in lines, lines
    st["b"]["battlefield"][0]["attacking"] = None
    assert "activephase=MAIN1" in state_lines(st, "b", names, "/nao/existe", [])
    assert _ctr("+1/+1") == "P1P1" and _ctr("-0/-1") == "M0M1" and _ctr("loyalty") == "LOYALTY"
    print("play.py: ok")


if __name__ == "__main__":
    selfcheck()
