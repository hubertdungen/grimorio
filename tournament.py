"""Grimório — torneios: vários decks jogam entre si no Forge (sim.py), com chave, emparelhamentos e registo.

Tipos (TYPES): eliminação simples (isentos quando não são potência de 2, 3.º lugar opcional), dupla eliminação
(chave dos vencedores + chave dos vencidos + grande final, com 2.ª final se o campeão dos vencidos ganhar a 1.ª),
suíço (N rondas, emparelhar pelos pontos sem repetir adversários, isento ao último sem isenção; desempate OMW% e GW%),
liga (todos contra todos, método do círculo) e mesas (3–4 jogadores todos contra todos por mesa; pontos pelo lugar:
1.º 3, depois mesa-1-lugar… o último 0; as mesas refazem-se a cada ronda pelos pontos).

Cada partida joga-se jogo a jogo: um trabalho do sim por jogo, na fila de sempre (um de cada vez, a RAM não dá para
mais). O estado vive na SQLite (tabela tournaments, JSON) e os jogos com o registo inteiro em tournament_games
(comprimidos com zlib). Uma thread (`runner`) faz avançar os torneios «a decorrer» mesmo com o browser fechado; depois
de reiniciar o servidor o trabalho perdido da partida em curso volta à fila sozinho (sim.status devolve None).

Empates: na eliminação o jogo repete-se (até MAX_EXTRA jogos a mais); se continuar empatado ganha quem tem mais
vitórias e, sem isso, o melhor seed. No suíço e na liga um empate conta 1 ponto. Jogos partidos (o Forge rebentou)
e trabalhos falhados repetem-se até MAX_ERRORS vezes; depois a partida fecha como empate (ou pelo seed na eliminação).
Bo3 com sideboard inteligente entre jogos (porta de web/src/sideboard.js: o que o adversário lançou nos jogos exatos
desta partida + a lista dele, cartas presas na mão; aprende com as trocas que já perderam contra o mesmo adversário em
torneios e no Laboratório). Só decks com sideboard e de formatos que o permitem; as trocas ficam no jogo (g[k].sb).
Modo casual: decks de formatos diferentes; `format` passa a ser o das regras base (tipo de jogo e vida de todos) e cada
deck com comandante joga com ele (sim.submit casual=True). Decks marcados casuais só entram em torneios casuais.
Cada partida a dois que acaba entra nos ratings (ratings.record_round, chave deck:<id> ou meta:<id>; os casuais no
rating casual, casual=True, e também os torneios sem decks meta: só azul e vermelho); as mesas não entram (o Elo é a dois e o lugar numa mesa de 4 não é uma vitória sobre cada um).
«O meu deck» (st.me): um dos participantes é «eu»; me_state diz onde está, se caiu e o lugar final. No fim fica o pódio
(st.podium: lugares 1–3 de ranking(), com empates no 3.º sem jogo de 3.º lugar) para o registo e o hall da fama.
"""
import json, math, os, random, re, sqlite3, sys, threading, time, uuid, zlib
from collections import Counter
import sim
try:
    import ratings  # Elo dos decks (outro módulo; enquanto não existir, os torneios não mexem nos ratings)
except ImportError:
    ratings = None

START_WAIT = 10  # segundos entre criar o torneio e o 1.º jogo (tempo para apostar)
TYPES = {"elim": (4, 16), "dupla": (4, 16), "suico": (4, 32), "liga": (4, 16), "mesas": (4, 16)}
MAX_EXTRA = 2   # jogos a mais numa partida de eliminação para desfazer empates
MAX_ERRORS = 3  # jogos partidos / trabalhos falhados por partida antes de a fechar
LOCK = threading.RLock()
DATA = DB = None
BUSY = lambda: False  # noqa: E731 — o server.py diz se há um jogo teu contra o Forge (não chega a RAM para os dois)


# ---------- chaves e emparelhamentos (puro) ----------

def M(mid, b, r, p=None, src=None):
    """Partida: p = participantes (índices; -1 = ainda por saber, None = isento), src = [[partida, "w"|"l"], …]."""
    return {"id": mid, "b": b, "r": r, "p": p or [-1, -1], "src": src, "w": [0, 0], "g": [], "st": "wait",
            "win": None, "lose": None}


def seeds(P):
    o = [1]
    while len(o) < P:  # 1-8, 4-5, 2-7, 3-6: os melhores só se encontram no fim
        o = [x for s in o for x in (s, 2 * len(o) + 1 - s)]
    return o


def bracket(n, third=False, double=False):
    P = 1 << (n - 1).bit_length()
    k = P.bit_length() - 1
    o = seeds(P)
    ms = [M(f"W1-{i + 1}", "W", 1, [o[2 * i] - 1 if o[2 * i] <= n else None, o[2 * i + 1] - 1 if o[2 * i + 1] <= n else None])
          for i in range(P // 2)]
    for r in range(2, k + 1):
        ms += [M(f"W{r}-{i + 1}", "W", r, src=[[f"W{r - 1}-{2 * i + 1}", "w"], [f"W{r - 1}-{2 * i + 2}", "w"]]) for i in range(P >> r)]
    if third and not double:
        ms.append(M("3", "3", k, src=[[f"W{k - 1}-1", "l"], [f"W{k - 1}-2", "l"]]))
    if double:
        ms += [M(f"L1-{i + 1}", "L", 1, src=[[f"W1-{2 * i + 1}", "l"], [f"W1-{2 * i + 2}", "l"]]) for i in range(P // 4)]
        for j in range(1, k):
            c = P >> (j + 1)  # vencedores da ronda anterior dos vencidos contra os que caem da ronda j+1, da outra metade
            ms += [M(f"L{2 * j}-{i + 1}", "L", 2 * j, src=[[f"L{2 * j - 1}-{i + 1}", "w"],  # da chave (sem repetir já)
                                                           [f"W{j + 1}-{(c - 1 - i if j % 2 else i) + 1}", "l"]]) for i in range(c)]
            if j < k - 1:
                ms += [M(f"L{2 * j + 1}-{i + 1}", "L", 2 * j + 1, src=[[f"L{2 * j}-{2 * i + 1}", "w"], [f"L{2 * j}-{2 * i + 2}", "w"]])
                       for i in range(c // 2)]
        ms.append(M("GF", "F", 1, src=[[f"W{k}-1", "w"], [f"L{2 * k - 2}-1", "w"]]))
        ms.append({**M("GF2", "F", 2, src=[["GF", "w"], ["GF", "l"]]), "reset": 1})
    # ordem de jogo: cada ronda dos vencidos logo a seguir à dos vencedores de que depende; 3.º lugar antes da final
    key = lambda m: {"W": 1 if m["r"] == 1 else 2 * m["r"] - 0.5, "L": m["r"] + 2, "3": 2 * k - 0.75, "F": 100 + m["r"]}[m["b"]]
    return sorted(ms, key=key), ("GF2" if double else f"W{k}-1")


def league(n):
    ids, ms = list(range(n)) + ([None] if n % 2 else []), []
    N = len(ids)
    for r in range(N - 1):  # método do círculo: o primeiro fica, os outros rodam
        ms += [M(f"R{r + 1}-{i + 1}", "R", r + 1, [ids[i], ids[N - 1 - i]]) for i in range(N // 2)
               if ids[i] is not None and ids[N - 1 - i] is not None]
        ids = [ids[0], ids[-1]] + ids[1:-1]
    return ms


def pair(order, met):
    """Emparelha pela ordem (pontos) sem repetir adversários; None se não houver maneira."""
    if not order:
        return []
    a = order[0]
    for b in order[1:]:
        if b not in met[a]:
            rest = pair([x for x in order[1:] if x != b], met)
            if rest is not None:
                return [(a, b)] + rest
    return None


def next_round(st):
    r = 1 + max((m["r"] for m in st["matches"]), default=0)
    tab = standings(st)
    order = [t["i"] for t in tab]
    if st["type"] == "mesas":  # mesas de 4 (ou 3, ou 2 no limite), os de pontos parecidos juntos
        n, k = len(order), 0
        p = -(-n // 4)
        for i in range(p):
            s = n // p + (i < n % p)
            st["matches"].append({**M(f"R{r}-{i + 1}", "P", r, order[k:k + s]), "w": None})
            k += s
        return
    met = {t["i"]: set(t["opp"]) for t in tab}
    ms = []
    if len(order) % 2:  # isento: o mais abaixo que ainda não foi
        had = {m["win"] for m in st["matches"] if m.get("bye")}
        b = next((x for x in reversed(order) if x not in had), order[-1])
        order.remove(b)
        ms.append(M(f"R{r}-{len(order) // 2 + 1}", "R", r, [b, None]))
    pairs = pair(order, met) or list(zip(order[::2], order[1::2]))  # ponytail: backtracking simples; n ≤ 32 chega
    st["matches"] += [M(f"R{r}-{i + 1}", "R", r, [a, b]) for i, (a, b) in enumerate(pairs)] + ms


def build(t, n, bo=1, third=False, rounds=None):
    st = {"type": t, "bo": bo, "third": bool(third), "rounds": rounds, "matches": [], "champion": None}
    if t in ("elim", "dupla"):
        st["matches"], st["final"] = bracket(n, third, t == "dupla")
    elif t == "liga":
        st["matches"] = league(n)
    st["n"] = n
    resolve(st)
    return st


def resolve(st):
    """Preenche os lugares que já se sabem, despacha isentos, cria a ronda seguinte e vê se há campeão."""
    while True:
        ms, changed = {m["id"]: m for m in st["matches"]}, False
        for m in st["matches"]:
            if m["st"] != "wait":
                continue
            for k, (sid, wl) in enumerate(m["src"] or ()):
                if ms[sid]["st"] == "done" and m["p"][k] == -1:
                    m["p"][k] = ms[sid]["win" if wl == "w" else "lose"]
            if -1 in m["p"]:
                continue
            changed, real = True, [x for x in m["p"] if x is not None]
            if m.get("reset") and ms["GF"]["win"] == ms["GF"]["p"][0]:  # o invicto ganhou a final: não há 2.ª
                m.update(st="done", skip=1, win=ms["GF"]["win"], lose=ms["GF"]["lose"])
            elif len(real) >= 2:
                m["st"] = "ready"
            else:
                m.update(st="done", bye=1, win=real[0] if real else None)
        played = max((m["r"] for m in st["matches"]), default=0)
        if st["type"] in ("suico", "mesas") and played < st["rounds"] and all(m["st"] == "done" for m in st["matches"]):
            next_round(st)
            changed = True
        if not changed:
            break
    if all(m["st"] == "done" for m in st["matches"]) and st["matches"]:
        st["champion"] = {m["id"]: m for m in st["matches"]}[st["final"]]["win"] if st.get("final") else standings(st)[0]["i"]


def standings(st):
    T = [{"i": i, "pts": 0, "v": 0, "d": 0, "e": 0, "gw": 0, "gl": 0, "opp": [], "bye": 0} for i in range(st["n"])]
    for m in st["matches"]:
        if m["st"] != "done" or m.get("skip"):
            continue
        if m["b"] == "P":
            if m.get("pl"):
                for k, x in enumerate(m["pl"]):
                    T[x]["pts"] += 3 if k == 0 else len(m["pl"]) - 1 - k
                    T[x]["v" if k == 0 else "d"] += 1
            else:
                for x in m["p"]:
                    T[x]["pts"] += 1
                    T[x]["e"] += 1
            continue
        if m.get("bye"):
            if m["win"] is not None and st["type"] == "suico":
                T[m["win"]]["pts"] += 3
                T[m["win"]]["v"] += 1
                T[m["win"]]["bye"] += 1
            continue
        a, b = m["p"]
        T[a]["opp"].append(b)
        T[b]["opp"].append(a)
        for k, x in enumerate((a, b)):
            T[x]["gw"] += m["w"][k]
            T[x]["gl"] += m["w"][1 - k]
        if m["win"] is None:
            for x in (a, b):
                T[x]["pts"] += 1
                T[x]["e"] += 1
        else:
            T[m["win"]]["pts"] += 3
            T[m["win"]]["v"] += 1
            T[m["lose"]]["d"] += 1
    mwp = lambda t: max(1 / 3, t["pts"] / (3 * (t["v"] + t["d"] + t["e"]))) if t["v"] + t["d"] + t["e"] else 1 / 3
    for t in T:
        t["omw"] = round(sum(mwp(T[o]) for o in t["opp"]) / len(t["opp"]), 4) if t["opp"] else 0
        t["gwp"] = round(max(1 / 3, t["gw"] / (t["gw"] + t["gl"])), 4) if t["gw"] + t["gl"] else 0
    key = (lambda t: (-t["pts"], -t["v"], t["i"])) if st["type"] == "mesas" else \
        (lambda t: (-t["pts"], -t["omw"], -t["gwp"], t["i"]))
    return sorted(T, key=key)


def seats_for(m):
    """Lugares no Forge (a, b, …) para o próximo jogo: troca/roda a cada jogo."""
    k = len(m["g"]) % len(m["p"])
    return m["p"][k:] + m["p"][:k]


def decide(st, m, note=None):
    """Fecha a partida: ganha quem tem mais vitórias; empatada → o melhor seed na eliminação, empate nos outros."""
    if note:
        m["note"] = note
    if m["b"] == "P":
        return m.update(st="done", win=None, pl=None)
    if m["w"][0] != m["w"][1]:
        k = 0 if m["w"][0] > m["w"][1] else 1
    elif st["type"] in ("elim", "dupla"):
        k, m["tb"] = (0 if m["p"][0] < m["p"][1] else 1), 1  # desempate pelo seed
    else:
        return m.update(st="done", win=None, lose=None)
    m.update(st="done", win=m["p"][k], lose=m["p"][1 - k])


def record(st, m, g, gid):
    """Um jogo acabado (resultado do sim) -> partida atualizada."""
    seats = m["seats"]
    side = lambda s: seats[sim.SIDES.index(s)] if s in sim.SIDES[:len(seats)] else None
    win = None if g.get("crashed") else side(g.get("winner"))
    m["g"].append({"id": gid, "w": win, "t": g.get("turns"), "s": seats, **({"x": 1} if g.get("crashed") else {}),
                   **({"sb": m["sb"]} if m.get("sb") else {})})
    if g.get("crashed"):
        m["err"] = m.get("err", 0) + 1
        if m["err"] >= MAX_ERRORS:
            decide(st, m, "O Forge falhou vários jogos desta partida.")
        return
    if m["b"] == "P":
        if win is None:
            m["draws"] = m.get("draws", 0) + 1
            if m["draws"] > MAX_EXTRA:
                decide(st, m, "Empates seguidos: 1 ponto a cada.")
            return
        pl = [side(s) for s in g.get("places") or [g["winner"]]]
        return m.update(st="done", win=win, pl=pl + [x for x in seats if x not in pl])
    if win is not None:
        m["w"][m["p"].index(win)] += 1
    counted = sum(1 for x in m["g"] if not x.get("x"))
    elim = st["type"] in ("elim", "dupla")
    if max(m["w"]) > st["bo"] // 2 or counted >= st["bo"] + (MAX_EXTRA if elim else 0):
        decide(st, m)


def ranking(st):
    """Lugar final [de, até] de cada participante (com o torneio acabado). Nas chaves conta a última partida jogada:
    ronda mais adiantada primeiro e, na mesma, quem a ganhou; quem cai na mesma ronda empata (ex.: 5.º–8.º)."""
    if st["type"] not in ("elim", "dupla"):
        return {t["i"]: [k + 1, k + 1] for k, t in enumerate(standings(st))}
    grp, key = {}, {}
    for m in st["matches"]:
        g = grp.setdefault((m["b"], m["r"]), len(grp))  # a lista já está pela ordem de jogo
        if m["st"] == "done" and not m.get("bye") and not m.get("skip") and m["win"] is not None:
            key[m["win"]], key[m["lose"]] = (g, 1), (g, 0)
    ks = [key.get(i, (-1, 0)) for i in range(st["n"])]
    return {i: [1 + sum(x > k for x in ks), sum(x >= k for x in ks)] for i, k in enumerate(ks)}


def podium(st):
    P, me = st["players"], st.get("me")
    return sorted(({"i": i, "place": lo, **{k: P[i].get(k) for k in ("name", "src", "ref", "cover", "colors", "format")},
                    **({"me": True} if i == me else {})} for i, (lo, _) in ranking(st).items() if lo <= 3), key=lambda x: x["place"])


def me_state(st):
    """Onde está «o meu deck»: in (a jogar / à espera da próxima partida), out (eliminado, a chave segue) ou done."""
    i = st.get("me")
    if i is None:
        return None
    if st.get("champion") is not None:
        return {"phase": "done", "place": ranking(st)[i]}
    nxt = next((m for m in st["matches"] if m["st"] != "done" and i in m["p"]), None)
    if nxt or st["type"] not in ("elim", "dupla"):
        return {"phase": "in", "match": nxt and nxt["id"]}
    m = [m for m in st["matches"] if m["st"] == "done" and m.get("lose") == i and not m.get("skip")][-1]
    return {"phase": "out", "match": m["id"], "by": m["win"]}


# ---------- sideboard entre jogos (porta de web/src/sideboard.js e do perfil de web/src/tests.js) ----------

HATE = [(k, re.compile(r, re.I), label) for k, r, label in (
    ("artifacts", r"destroy (target|all|each)[^.]*artifact|artifacts? (can't|cost)|exile target artifact", "remove artefactos"),
    ("enchantments", r"destroy (target|all|each)[^.]*enchantment|exile target enchantment", "remove encantamentos"),
    ("graveyard", r"exile (all|each)[^.]*graveyards?|target player's graveyard|card (from|in) (a|an opponent's) graveyard|search its owner's graveyard"
                  r"|graveyards? (can't|lose)|cards in graveyards can't", "castiga o cemitério"),
    ("spells", r"counter target (spell|instant|sorcery|noncreature)|instant (and|or) sorcery spells? cost|nonland card from it|instant or sorcery card from it",
     "trava instantâneos e feitiços"),
    ("creatures", r"counter target creature spell|destroy all creatures|damage to each creature|each creature gets -|destroy target creature|exile target creature",
     "trava criaturas"),
    ("flyers", r"creature with flying|reach|destroy target creature with flying", "trava voadores"),
    ("lifegain", r"can't gain life|life total can't|players can't gain", "corta o ganho de vida"))]
CAT_LABEL = {"creatures": "criaturas", "flyers": "criaturas voadoras", "artifacts": "artefactos", "enchantments": "encantamentos",
             "spells": "instantâneos e feitiços", "graveyard": "cemitério", "lifegain": "ganho de vida"}
CARDS = {}  # nome -> o essencial do cards.json (só as cartas que já apareceram; None = desconhecida)


def cards(names):
    miss = set(names) - CARDS.keys()
    if miss:
        try:
            with open(os.path.join(DATA, "data", "cards.json"), encoding="utf-8") as f:
                for c in json.load(f):
                    if c["n"] in miss:
                        front = c["t"].split("//")[0]
                        CARDS[c["n"]] = {"o": c.get("o") or "", "t": c["t"], "cmc": c.get("cmc") or 0, "tg": c.get("tg") or [], "kw": c.get("kw") or [],
                                         "mt": next((t for t in ("Land", "Creature", "Planeswalker", "Battle", "Instant", "Sorcery", "Artifact",
                                                                 "Enchantment") if t in front), "Artifact")}
        except (OSError, ValueError, TypeError) as e:
            print(f"[torneio] cards.json: {e!r}", file=sys.stderr, flush=True)
        for n in miss:
            CARDS.setdefault(n, None)
    return CARDS


def profile(C, w):
    """Perfil de {nome: peso} (cópias, vezes lançada ou dano) pelas categorias de CAT_LABEL."""
    pr = dict.fromkeys(CAT_LABEL, 0) | {"total": 0}
    for n, q in w.items():
        c = C.get(n)
        if not c or c["mt"] == "Land":
            continue
        pr["total"] += q
        for k, ok in (("creatures", c["mt"] == "Creature"), ("artifacts", "Artifact" in c["t"]), ("enchantments", "Enchantment" in c["t"]),
                      ("spells", "Instant" in c["t"] or "Sorcery" in c["t"]), ("graveyard", "graveyard" in c["tg"] or "recursion" in c["tg"]),
                      ("lifegain", "lifegain" in c["tg"]), ("flyers", "Flying" in c["kw"])):
            pr[k] += q * ok
    return pr


def stuck_in(g, s, mn=2):
    """Cartas na mão de `s` em `mn` inícios de turno dele e nunca usadas (jogo exato: o «hd» só vem quando muda)."""
    held, hand = Counter(), []
    for e in g.get("events") or ():
        if s in (e.get("hd") or {}):
            hand = e["hd"][s]
        if e.get("k") == "turn" and e.get("p") == s:
            held.update(set(hand))
    used = set(((g.get("summary") or {}).get(s) or {}).get("used") or ())
    return [n for n, t in held.items() if t >= mn and n not in used]


def plan_side(C, deck, opp, games, lost=(), mx=5):
    """games: [(jogo, o meu lado, o lado dele)] desta partida -> trocas [{in, out, q, why, outWhy}]."""
    S = lambda g, s: (g.get("summary") or {}).get(s) or {}  # noqa: E731
    exact = [x for x in games if x[0].get("exact")]
    pl = profile(C, opp.get("main") or {})
    pc = profile(C, Counter(n for g, _, op in exact for _, n in S(g, op).get("cast") or ()))
    dmg = Counter()
    for g, _, op in games:
        dmg.update(S(g, op).get("damage_by_card") or {})
    ph = profile(C, dmg)
    sh = lambda p, k: p[k] / p["total"] if p["total"] else 0  # noqa: E731
    seen = pc["total"] >= 3  # jogou o suficiente para valer mais do que a lista
    share = lambda k: (0.65 * sh(pc, k) + 0.35 * sh(pl, k) if seen else sh(pl, k)) + 0.15 * sh(ph, k)  # noqa: E731
    cand = []
    for n, q in (deck.get("side") or {}).items():
        c = C.get(n)
        best = c and max(((share(k), label, k) for k, rx, label in HATE if rx.search(c["o"])), default=None, key=lambda x: x[0])
        if not best or best[0] < 0.12:
            continue
        v, label, k = best
        src = f"lançou {pc[k]} {CAT_LABEL[k]}" if seen and pc[k] else f"o adversário tem {round(sh(pl, k) * 100)}% de {CAT_LABEL[k]}"
        why = f"{label} ({src}{f'; tiraram-te {ph[k]} de vida' if ph[k] else ''})"
        if n in lost:
            v, why = v * 0.6, why + " · já perdeu com esta troca, vale menos"
        cand.append((v, n, q, why))
    cand.sort(key=lambda x: -x[0])
    # jogada = lançada ou usada de outra forma; nos jogos exatos só conta como parada a carta que chegou à mão
    cast = {e.get("card") for g, me, _ in games for e in g.get("events") or () if e.get("p") == me and e.get("k") == "cast"} | \
        {n for g, me, _ in games for n in S(g, me).get("used") or ()}
    drawn = {n for g, me, _ in exact for e in g.get("events") or () for n in (e.get("hd") or {}).get(me) or ()}
    idle = lambda n: n not in cast and (not exact or n in drawn)  # noqa: E731
    stuck = Counter(n for g, me, _ in exact for n in stuck_in(g, me))
    outs = []
    for n, q in deck["main"].items():
        c = C.get(n)
        if c and c["mt"] != "Land":
            v = 0.4 + 0.1 * stuck[n] if stuck[n] else 0.3 if idle(n) else 0
            v += 0.15 * (c["cmc"] >= 5) + 0.3 * ("removal" in c["tg"] and share("creatures") < 0.25) + 0.2 * ("counter" in c["tg"] and share("spells") < 0.2)
            outs.append((v, n, q, c))
    outs.sort(key=lambda x: -x[0])
    swaps = []
    for (_, n, q, why), (_, o, oq, c) in zip(cand[:mx], outs):
        swaps.append({"in": n, "out": o, "q": min(q, oq, 2), "why": why,
                      "outWhy": (f"ficou presa na mão{f' em {stuck[o]} jogos' if stuck[o] > 1 else ''}" if stuck[o] else "não chegou a ser jogada"
                                 if idle(o) else "cara para este confronto" if c["cmc"] >= 5 else "pouco útil contra este deck")})
    return swaps


def apply_swaps(deck, swaps):
    main, side = dict(deck["main"]), dict(deck.get("side") or {})
    for s in swaps:
        for a, b in ((main, s["out"]), (side, s["in"])):
            a[b] -= s["q"]
            if a[b] <= 0:
                del a[b]
        main[s["in"]] = main.get(s["in"], 0) + s["q"]
        side[s["out"]] = side.get(s["out"], 0) + s["q"]
    return {**deck, "main": main, "side": side}


def side_ok(st, i):
    f = st["players"][i]["format"]
    return st["bo"] > 1 and bool(st["decks"][i].get("side")) and sim.GAME_TYPE.get(f, "Constructed") == "Constructed" and f != "limited"


def lost_with(con, tid, owner, st, i, j):
    """Aprendizagem: cartas que este deck meteu do sideboard em jogos que perdeu contra este adversário (este torneio,
    os anteriores e o Laboratório)."""
    me, op = st["players"][i], st["players"][j]
    key = lambda p: (p["src"], p["ref"])  # noqa: E731
    out = set()
    for s in [st] + [json.loads(x) for (x,) in con.execute("SELECT state FROM tournaments WHERE owner=? AND id!=?", (owner, tid))]:
        P = s["players"]
        for m in s["matches"]:
            for x in m["g"]:
                for a, sw in (x.get("sb") or {}).items():
                    b = next((y for y in m["p"] if y != int(a)), None)
                    if b is not None and x["w"] == b and key(P[int(a)]) == key(me) and key(P[b]) == key(op):
                        out |= {y["in"] for y in sw}
    if me["src"] == "meus":
        try:
            for (r,) in con.execute("SELECT a_side_in FROM sim_games WHERE deck_id=? AND opp_name=? AND winner='b'",
                                    (me["ref"], re.sub(r" \(\d+\)$", "", op["name"]))):
                out |= set(json.loads(r or "[]"))
        except (sqlite3.Error, ValueError, TypeError):
            pass
    return out


def sideboard(con, tid, owner, st, m, i):
    """Trocas do deck i para o próximo jogo da partida m, a partir dos jogos já jogados nela."""
    j = next(x for x in m["p"] if x != i)
    gs = [x for x in m["g"] if not x.get("x")]
    if not gs:
        return []
    rows = dict(con.execute(f"SELECT id, game FROM tournament_games WHERE tid=? AND id IN ({','.join('?' * len(gs))})",
                            (tid, *[x["id"] for x in gs])).fetchall())
    games = []
    for x in gs:
        if x["id"] in rows:
            g = json.loads(zlib.decompress(rows[x["id"]]))
            games.append((g, sim.SIDES[x["s"].index(i)], sim.SIDES[x["s"].index(j)]))
    deck, opp = st["decks"][i], st["decks"][j]
    names = [*deck["main"], *deck.get("side", {}), *opp["main"], *opp.get("side", {})] + \
        [n for g, _, op in games for _, n in ((g.get("summary") or {}).get(op) or {}).get("cast") or ()]
    return plan_side(cards(names), deck, opp, games, lost_with(con, tid, owner, st, i, j))


# ---------- base de dados ----------

def db():
    con = sqlite3.connect(DB, timeout=15)
    con.execute("CREATE TABLE IF NOT EXISTS tournaments (id TEXT PRIMARY KEY, owner TEXT, ts REAL, name TEXT, type TEXT,"
                " format TEXT, status TEXT, champion TEXT, n INTEGER, state TEXT NOT NULL)")
    con.execute("CREATE TABLE IF NOT EXISTS tournament_games (id INTEGER PRIMARY KEY, tid TEXT, ts REAL, game BLOB)")
    con.execute("CREATE INDEX IF NOT EXISTS tournament_games_tid ON tournament_games (tid)")
    con.execute("CREATE TABLE IF NOT EXISTS wallets (owner TEXT PRIMARY KEY, coins INTEGER, subsidy TEXT)")
    con.execute("CREATE TABLE IF NOT EXISTS bets (id INTEGER PRIMARY KEY, owner TEXT, tid TEXT, kind TEXT, mid TEXT, pick INTEGER,"
                " stake INTEGER, odds REAL, ts REAL, status TEXT, payout INTEGER)")
    con.execute("CREATE INDEX IF NOT EXISTS bets_tid ON bets (tid, status)")
    return con


def save(con, tid, st, status=None):
    champ = st["players"][st["champion"]]["name"] if st.get("champion") is not None else None
    if champ is not None:
        status, st["podium"] = "done", podium(st)
    con.execute("UPDATE tournaments SET state=?, champion=?" + (", status=?" if status else "") + " WHERE id=?",
                (json.dumps(st, ensure_ascii=False), champ, *([status] if status else []), tid))
    settle(con, tid, st)


def create(owner, d):
    t, fmt = d.get("type"), str(d.get("format") or "").lower()[:40]
    if t not in TYPES:
        raise ValueError("Tipo de torneio desconhecido.")
    ps = d.get("players")
    lo, hi = TYPES[t]
    if not isinstance(ps, list) or not lo <= len(ps) <= hi:
        raise ValueError(f"Este tipo de torneio leva entre {lo} e {hi} participantes.")
    casual = bool(d.get("casual"))
    cmd = sim.GAME_TYPE.get(fmt, "Constructed") != "Constructed" and not casual
    meta_ok = lambda ref: re.fullmatch(r"(%s)-\d{1,10}|edhrec-[a-z0-9-]{1,120}" % "|".join(sim.META_FORMATS), ref) if casual else \
        ref.startswith(fmt + "-") or fmt in sim.EDH_FORMATS and ref.startswith("edhrec-")  # noqa: E731
    diffs = {x[0] for x in sim.DIFFICULTIES}
    players, decks = [], []
    with db() as con:
        for x in ps:
            x = x if isinstance(x, dict) else {}
            src, ref, deck = x.get("src"), str(x.get("ref") or "")[:140], None
            if src == "meus":
                r = con.execute("SELECT body FROM decks WHERE id=? AND owner=? AND deleted IS NULL", (ref, owner)).fetchone()
                deck = json.loads(r[0]) if r else None
                if deck and not casual and deck.get("casual"):
                    raise ValueError(f"«{deck.get('name')}» é um deck casual: só entra em torneios casuais.")
                if deck and not casual and str(deck.get("format") or "").lower() != fmt:
                    raise ValueError(f"«{deck.get('name')}» não é um deck de {fmt}: num torneio todos jogam o mesmo formato.")
                if deck and not casual and deck.get("casual"):
                    raise ValueError(f"«{deck.get('name')}» é um deck casual: só entra em torneios casuais.")
            elif src == "meta" and meta_ok(ref):
                deck = sim.opponent(DATA, ref)
            if not deck or not isinstance(deck.get("main"), dict) or not deck["main"]:
                raise ValueError("Um dos decks não existe ou está vazio.")
            if cmd and not deck.get("commanders"):
                raise ValueError(f"«{deck.get('name')}»: falta o comandante.")
            name = str(deck.get("name") or "Deck")[:120]
            same = sum(1 for p in players if p["name"].split(" (")[0] == name)
            players.append({"name": f"{name} ({same + 1})" if same else name, "src": src, "ref": ref,
                            "difficulty": x.get("difficulty") if x.get("difficulty") in diffs else "default",
                            "format": str(deck.get("format") or (ref.split("-")[0] if src == "meta" else fmt)).lower()[:40]
                            .replace("edhrec", "commander"),
                            "cover": str(x.get("cover") or "")[:200],
                            "colors": "".join(c for c in str(x.get("colors") or "") if c in "WUBRG")[:5],
                            **({"me": True} if x.get("me") and src == "meus" and not any(p.get("me") for p in players) else {})})
            decks.append({k: deck.get(k) or ({} if k in ("main", "side") else []) for k in ("commanders", "main", "side")} |
                         ({"signature": deck["signature"]} if deck.get("signature") else {}) |
                         ({"art": deck["art"]} if isinstance(deck.get("art"), dict) and deck["art"] else {}))  # artes próprias para o tabuleiro
        if d.get("seeding") != "ordem":
            order = random.sample(range(len(players)), len(players))
            players, decks = [players[i] for i in order], [decks[i] for i in order]
        n = len(players)
        bo = 3 if d.get("bo") == 3 and t != "mesas" else 1
        rounds = None
        if t in ("suico", "mesas"):
            base = math.ceil(math.log2(n)) if t == "suico" else 3
            try:
                rounds = max(1, min(base + 3, int(d.get("rounds") or base)))
            except (TypeError, ValueError):
                rounds = base
        st = build(t, n, bo, bool(d.get("third")), rounds)
        me = next((i for i, p in enumerate(players) if p.pop("me", None)), None)
        st.update(format=fmt, players=players, decks=decks, **({"casual": True} if casual else {}), **({"me": me} if me is not None else {}))
        # começo: START_WAIT s para apostar (ou, com hold, só quando o dono carregar em «Começar»)
        st.update(start_at=time.time() + START_WAIT, **({"hold": True} if d.get("hold") else {}))
        if d.get("champions"):  # torneio dos campeões (vencedores de torneios anteriores): o 1.º leva o troféu de platina
            st["champions"] = True
        tid = uuid.uuid4().hex[:12]
        name = str(d.get("name") or "").strip()[:120] or "Torneio"
        con.execute("INSERT INTO tournaments VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (tid, owner, time.time(), name, t, fmt, "running", None, n, json.dumps(st, ensure_ascii=False)))
    return tid


def public(row):
    tid, ts, name, t, fmt, status, champ, n, state = row
    st = json.loads(state)
    st.pop("decks", None)
    lives = []  # todas as partidas no Forge (com vários jogos ao mesmo tempo há mais do que uma); `live` = a 1.ª
    for m in (m for m in st["matches"] if m.get("job")):
        s = sim.status(m["job"]) or {"status": "queued"}
        lives.append({"match": m["id"], "job": m["job"], "status": s["status"], "position": s.get("position"), "seats": m.get("seats")})
    live = lives[0] if lives else None
    return {"id": tid, "ts": ts, "name": name, "type": t, "format": fmt, "status": status, "champion": champ, "n": n,
            **st, "standings": standings(st), "live": live, "lives": lives, "me_state": me_state(st),
            "starts_in": None if st.get("hold") else max(0.0, round(st.get("start_at", 0) - time.time(), 1)),
            "podium": st.get("podium") or (podium(st) if st.get("champion") is not None else None)}


def similarity(a, b):
    """Semelhança entre duas listas (0–1): soma dos mínimos / soma dos máximos das quantidades de cada carta, o
    comandante conta como uma cópia (o mesmo que web/src/DeckCompare.jsx)."""
    def q(d):
        m = dict(d.get("main") or {})
        for n in d.get("commanders") or []:
            m[n] = m.get(n, 0) + 1
        return m
    A, B = q(a), q(b)
    hi = sum(max(A.get(n, 0), B.get(n, 0)) for n in set(A) | set(B))
    return sum(min(A.get(n, 0), B.get(n, 0)) for n in set(A) | set(B)) / hi if hi else 0.0


SAME = 0.9  # um troféu conta enquanto a lista de hoje tiver ≥ 90% da que ganhou (mudou no máximo 10%)


def trophies(con, owner):
    """{id do deck: [pódios em torneios: ouro, prata e bronze, cada lugar do mais recente]}: resumo de cada um (data, tipo,
    formato, nº de decks, lugar, registo, 1.º e 2.º lugar) e `same` = semelhança da lista de hoje com a do torneio;
    `valid` = same ≥ SAME (o troféu só conta enquanto a lista não mudar mais de 10%)."""
    cur = {i: json.loads(b or "{}") for i, b in con.execute(
        "SELECT id, body FROM decks WHERE owner=? AND (deleted IS NULL OR deleted=0)", (owner,))}
    out = {}
    for tid, ts, name, typ, fmt, raw in con.execute("SELECT id, ts, name, type, format, state FROM tournaments"
                                                    " WHERE owner=? AND status='done' ORDER BY ts DESC", (owner,)):
        st = json.loads(raw)
        if st.get("champion") is None or not st.get("decks"):
            continue
        pod, rows = podium(st), {x["i"]: x for x in standings(st)}
        for x in pod:  # ouro, prata e bronze (empates no 3.º: todos bronze)
            if x.get("src") != "meus" or x.get("ref") not in cur:
                continue
            row, same = rows.get(x["i"], {}), round(similarity(st["decks"][x["i"]], cur[x["ref"]]), 3)
            out.setdefault(x["ref"], []).append({
                "tid": tid, "ts": ts, "name": name, "type": typ, "format": fmt, "n": st["n"], "casual": bool(st.get("casual")),
                "place": x["place"], "platinum": bool(st.get("champions")) and x["place"] == 1,
                "rec": [row.get("v", 0), row.get("d", 0), row.get("e", 0)],
                "first": [y["name"] for y in pod if y["place"] == 1 and y["i"] != x["i"]],
                "second": [y["name"] for y in pod if y["place"] == 2 and y["i"] != x["i"]], "same": same, "valid": same >= SAME})
    for v in out.values():
        v.sort(key=lambda t: (t["place"], -t["ts"]))
    return out


def route(method, path, owner, body=None):
    """/api/tournaments… -> (código, objeto)."""
    parts = path.split("?")[0].strip("/").split("/")[2:]
    tid = parts[0] if parts and len(parts[0]) == 12 and parts[0].isalnum() else None
    if method == "GET" and parts == ["trophies"]:
        with db() as con:
            return 200, trophies(con, owner)
    if parts and not tid:
        return 404, {"erro": "não existe"}
    if method == "POST" and not parts:
        try:
            return 201, {"id": create(owner, body or {})}
        except ValueError as e:
            return 400, {"erro": str(e)}
    with db() as con:
        if method == "GET" and not parts:
            rows = con.execute("SELECT id, ts, name, type, format, status, champion, n, json_extract(state, '$.casual'),"
                               " json_extract(state, '$.podium'), json_extract(state, '$.me'), json_extract(state, '$.champions') FROM tournaments WHERE owner=? ORDER BY ts DESC",
                               (owner,)).fetchall()
            out = [dict(zip(("id", "ts", "name", "type", "format", "status", "champion", "n", "casual", "podium", "me", "champions"), r)) for r in rows]
            for x in out:  # os acabados antes de haver pódio calculam-no agora
                x["podium"] = json.loads(x["podium"]) if x["podium"] else podium(json.loads(con.execute(
                    "SELECT state FROM tournaments WHERE id=?", (x["id"],)).fetchone()[0])) if x["champion"] is not None else None
            return 200, out
        row = con.execute("SELECT id, ts, name, type, format, status, champion, n, state FROM tournaments WHERE id=? AND owner=?",
                          (tid, owner)).fetchone()
        if not row:
            return 404, {"erro": "Esse torneio não existe."}
        if method == "GET" and len(parts) == 1:
            return 200, public(row)
        if method == "GET" and len(parts) == 3 and parts[1] == "games" and parts[2].isdigit():
            r = con.execute("SELECT game FROM tournament_games WHERE id=? AND tid=?", (int(parts[2]), tid)).fetchone()
            if not r:
                return 404, {"erro": "Esse jogo não existe."}
            g, ds = json.loads(zlib.decompress(r[0])), json.loads(row[8]).get("decks") or []
            g["arts"] = {"abcd"[k]: ds[i]["art"] for k, i in enumerate(g.get("seats") or []) if k < 4 and isinstance(i, int) and i < len(ds) and ds[i].get("art")}
            return 200, g
        if method == "GET" and len(parts) == 2 and parts[1] == "bets":
            return 200, bets_view(con, owner, tid, row[5], json.loads(row[8]))
        if method == "POST" and len(parts) == 2 and parts[1] == "bets":
            with LOCK:  # o step() também segura o LOCK: a janela não fecha a meio da aposta
                status, state = con.execute("SELECT status, state FROM tournaments WHERE id=?", (tid,)).fetchone()
                try:
                    place(con, owner, tid, status, json.loads(state), body or {})
                except ValueError as e:
                    return 400, {"erro": str(e)}
            return 201, bets_view(con, owner, tid, status, json.loads(state))
        if method == "DELETE" and len(parts) == 1:  # só este torneio, pelo id
            settle(con, tid, json.loads(row[8]), cancelled=True)
            stop(con, tid, row[8])
            con.execute("DELETE FROM tournament_games WHERE tid=?", (tid,))
            con.execute("DELETE FROM tournaments WHERE id=? AND owner=?", (tid, owner))
            return 200, {"ok": True}
        if method == "POST" and len(parts) == 2 and parts[1] == "start":  # «Começar» / «Começar já»
            with LOCK:
                row = con.execute("SELECT status, state FROM tournaments WHERE id=?", (tid,)).fetchone()
                st = json.loads(row[1])
                st.pop("hold", None)
                st["start_at"] = time.time()
                con.execute("UPDATE tournaments SET state=? WHERE id=?", (json.dumps(st, ensure_ascii=False), tid))
            return 200, {"status": row[0]}
        if method == "POST" and len(parts) == 2 and parts[1] in ("pause", "resume", "cancel"):
            with LOCK:
                status = con.execute("SELECT status FROM tournaments WHERE id=?", (tid,)).fetchone()[0]
                if status in ("done", "cancelled"):
                    return 409, {"erro": "Este torneio já acabou."}
                if parts[1] == "cancel":
                    stop(con, tid, con.execute("SELECT state FROM tournaments WHERE id=?", (tid,)).fetchone()[0])
                new = {"pause": "paused", "resume": "running", "cancel": "cancelled"}[parts[1]]
                con.execute("UPDATE tournaments SET status=? WHERE id=?", (new, tid))
                if new == "cancelled":
                    settle(con, tid, json.loads(con.execute("SELECT state FROM tournaments WHERE id=?", (tid,)).fetchone()[0]), cancelled=True)
            return 200, {"status": new}
    return 404, {"erro": "rota desconhecida"}


def stop(con, tid, state):
    """Pára já o jogo em curso deste torneio (cancelar/apagar)."""
    with LOCK:
        st = json.loads(state)
        for m in st["matches"]:
            if m.get("job"):
                sim.cancel(m.pop("job"))
                m.pop("seats", None)
                m.pop("sb", None)
        con.execute("UPDATE tournaments SET state=? WHERE id=?", (json.dumps(st, ensure_ascii=False), tid))


# ---------- apostas: moedas virtuais (🪙), nada se compra nem vale dinheiro ----------
# Carteira por dono (1000 ao começar; abaixo de 50 recebe um subsídio até 100, uma vez por dia, ao abrir o torneio).
# Apostas no campeão (até começar a 2.ª ronda) e no vencedor de uma partida/mesa (até o Forge a começar).
# Probabilidades pelo Elo (força 10^(elo/400); a dois é ratings.expected()); o campeão por Monte Carlo do resto do torneio.
# Odd = 0,95 / p entre 1,05 e 50, fixa no momento da aposta. Liquida-se em save(); cancelar/apagar devolve tudo.

START_COINS, SUBSIDY, BROKE, MC_RUNS = 1000, 100, 50, 400
_ODDS = {}  # (tid, assinatura do estado) -> odds; ponytail: cache em memória, limpa-se toda aos 64


def wallet(con, owner, top=False):
    con.execute("INSERT OR IGNORE INTO wallets VALUES (?,?,NULL)", (owner, START_COINS))
    coins, last = con.execute("SELECT coins, subsidy FROM wallets WHERE owner=?", (owner,)).fetchone()
    today = time.strftime("%Y-%m-%d")
    if top and coins < BROKE and last != today:
        coins, last = SUBSIDY, today
        con.execute("UPDATE wallets SET coins=?, subsidy=? WHERE owner=?", (coins, today, owner))
    return {"coins": coins, "subsidy": last == today}


def elos(con, st):
    """Elo atual de cada participante no formato do torneio (o casual primeiro se o torneio conta para o casual)."""
    fmts = [st["format"]] if counts_yellow(st) else ["casual", st["format"]]
    out = []
    for p in st["players"]:
        key, r = ("deck:" if p["src"] == "meus" else "meta:") + str(p["ref"]), None
        for f in fmts:
            try:
                r = r or con.execute("SELECT elo FROM ratings WHERE key=? AND format=?", (key, f)).fetchone()
            except sqlite3.OperationalError:  # sem tabela de ratings: todos a 1500
                break
        out.append(r[0] if r else 1500.0)
    return out


def win_probs(m, elo):
    s = [10 ** (elo[i] / 400) for i in m["p"]]
    return [x / sum(s) for x in s]


def to_odds(p):
    return round(min(50.0, max(1.05, 0.95 / p)) if p > 0 else 50.0, 2)


def champ_probs(st, elo, runs=MC_RUNS, rng=random):
    """Joga o resto do torneio `runs` vezes com as probabilidades do Elo -> probabilidade de cada um ser campeão."""
    cnt, base = [0] * st["n"], json.dumps(st["matches"])
    for _ in range(runs):
        s = {**st, "matches": json.loads(base), "champion": None}
        while s["champion"] is None:
            todo = [m for m in s["matches"] if m["st"] == "ready"]
            if not todo:
                break
            for m in todo:
                k = rng.choices(range(len(m["p"])), win_probs(m, elo))[0]
                w = m["p"][k]
                if m["b"] == "P":
                    m.update(st="done", win=w, pl=[w] + rng.sample([x for x in m["p"] if x != w], len(m["p"]) - 1))
                else:
                    m.update(st="done", win=w, lose=m["p"][1 - k], w=[1, 0] if k == 0 else [0, 1])
            resolve(s)
        if s["champion"] is not None:
            cnt[s["champion"]] += 1
    return [c / runs for c in cnt]


def champ_open(st, status):
    return status in ("running", "paused") and st.get("champion") is None and \
        not any(m["r"] >= 2 and (m.get("job") or m["g"]) for m in st["matches"])


def match_open(m, status):
    return status in ("running", "paused") and m["st"] == "ready" and not m.get("job") and not m["g"]


def odds_of(con, tid, st, status):
    sig = (tid, status, tuple((m["st"], bool(m.get("job")), len(m["g"])) for m in st["matches"]))
    if sig not in _ODDS:
        elo = elos(con, st)
        if len(_ODDS) > 64:
            _ODDS.clear()
        _ODDS[sig] = {"champ": [to_odds(p) if p > 0 else None for p in champ_probs(st, elo)] if champ_open(st, status) else None,  # None = já não pode ganhar
                      "match": {m["id"]: [to_odds(p) for p in win_probs(m, elo)] for m in st["matches"] if match_open(m, status)}}
    return _ODDS[sig]


def place(con, owner, tid, status, st, d):
    kind, pick = d.get("kind"), d.get("pick")
    try:
        stake = int(d.get("stake"))
    except (TypeError, ValueError):
        raise ValueError("Aposta inválida.") from None
    if not 1 <= stake <= wallet(con, owner)["coins"]:
        raise ValueError("Não tens moedas que cheguem para essa aposta.")
    o, mid = odds_of(con, tid, st, status), None
    if not isinstance(pick, int) or isinstance(pick, bool):
        raise ValueError("Aposta inválida.")
    if kind == "champ":
        if not o["champ"]:
            raise ValueError("As apostas no campeão já fecharam.")
        if not 0 <= pick < st["n"]:
            raise ValueError("Aposta inválida.")
        x = o["champ"][pick]
        if x is None:
            raise ValueError("Esse deck já não pode ganhar o torneio.")
    elif kind == "match":
        m = next((m for m in st["matches"] if m["id"] == d.get("mid")), None)
        if not m or m["id"] not in o["match"]:
            raise ValueError("As apostas nesta partida já fecharam.")
        if pick not in m["p"]:
            raise ValueError("Aposta inválida.")
        x, mid = o["match"][m["id"]][m["p"].index(pick)], m["id"]
    else:
        raise ValueError("Aposta inválida.")
    con.execute("UPDATE wallets SET coins=coins-? WHERE owner=?", (stake, owner))
    con.execute("INSERT INTO bets (owner, tid, kind, mid, pick, stake, odds, ts, status) VALUES (?,?,?,?,?,?,?,?, 'open')",
                (owner, tid, kind, mid, pick, stake, x, time.time()))


def settle(con, tid, st, cancelled=False):
    """Apostas abertas deste torneio -> ganhas (stake × odd), perdidas ou devolvidas (empate, isento, cancelado)."""
    ms = {m["id"]: m for m in st["matches"]}
    for bid, owner, kind, mid, pick, stake, x in con.execute(
            "SELECT id, owner, kind, mid, pick, stake, odds FROM bets WHERE tid=? AND status='open'", (tid,)).fetchall():
        if cancelled:
            res = "refund"
        elif kind == "champ":
            if st.get("champion") is None:
                continue
            res = "won" if st["champion"] == pick else "lost"
        else:
            m = ms.get(mid)
            if not m or m["st"] != "done":
                continue
            res = "refund" if m["win"] is None or m.get("skip") or m.get("bye") else "won" if m["win"] == pick else "lost"
        pay = round(stake * x) if res == "won" else stake if res == "refund" else 0
        con.execute("UPDATE bets SET status=?, payout=? WHERE id=?", (res, pay, bid))
        if pay:
            con.execute("UPDATE wallets SET coins=coins+? WHERE owner=?", (pay, owner))


def bets_view(con, owner, tid, status, st):
    mine = [dict(zip(("id", "kind", "mid", "pick", "stake", "odds", "ts", "status", "payout"), r)) for r in con.execute(
        "SELECT id, kind, mid, pick, stake, odds, ts, status, payout FROM bets WHERE owner=? AND tid=? ORDER BY id DESC", (owner, tid))]
    return {**wallet(con, owner, top=True), "bets": mine, **odds_of(con, tid, st, status)}


# ---------- a thread que faz avançar os torneios ----------

def counts_yellow(st):
    """O rating normal (amarelo) só se mexe com decks meta na mesa: um torneio só entre os meus decks, ou casual, vai para
    o casual (conta no azul e no vermelho, não no amarelo)."""
    return not st.get("casual") and any(p["src"] == "meta" for p in st["players"])


def rate(con, tid, st, m, owner):
    """Partida a dois acabada -> ratings; isentos, 2.ª final saltada e mesas ficam de fora."""
    if ratings is None or m["b"] == "P" or m.get("bye") or m.get("skip"):
        return
    a, b = m["p"]
    gs = [x for x in m["g"] if not x.get("x")]
    games = ["a" if x["w"] == a else "b" if x["w"] == b else "draw" for x in gs]
    who = lambda i: ratings.ref(st["players"][i]["src"], st["players"][i]["ref"], st["players"][i]["name"], owner)  # noqa: E731
    if games:
        try:
            kw = {} if counts_yellow(st) else {"casual": True}
            if hasattr(ratings, "progs_of"):  # progresso rumo à vitória de cada um (estrelas vermelhas), dos jogos inteiros
                rows = dict(con.execute(f"SELECT id, game FROM tournament_games WHERE id IN ({','.join('?' * len(gs))})",
                                        [x["id"] for x in gs]).fetchall())
                kw["progs"] = [ratings.progs_of(json.loads(zlib.decompress(rows[x["id"]])), st.get("base") or st["format"],
                                                (sim.SIDES[x["s"].index(a)], sim.SIDES[x["s"].index(b)]))
                               if x["id"] in rows else None for x in gs]
            try:
                ratings.record_round(con, st["format"], a=who(a), b=who(b), games=games, source="torneio", round_id=f"{tid}:{m['id']}", **kw)
            except TypeError:  # ratings sem rating casual: os casuais ficam de fora
                if not kw:
                    raise
        except Exception as e:  # os ratings são um extra: o torneio segue
            print(f"[torneio {tid}] ratings: {e!r}", file=sys.stderr, flush=True)


def started(st):
    """Já pode jogar: passou o tempo de apostas e não está à espera do OK do dono."""
    return not st.get("hold") and time.time() >= st.get("start_at", 0)


def next_match(st):
    """A próxima partida a mandar para o Forge: pronta, sem trabalho, e sem nenhum deck que já esteja a jogar noutra mesa
    (com vários jogos ao mesmo tempo, cada deck joga uma partida de cada vez: o sideboard e a aprendizagem usam o jogo
    anterior). Os jogos da mesma partida são sempre seguidos: um trabalho = um jogo."""
    busy = {i for x in st["matches"] if x.get("job") for i in x["p"]}
    return next((m for m in st["matches"] if m["st"] == "ready" and not m.get("job") and not busy & set(m["p"])), None)


def step():
    """Um passo: trata os jogos em curso (o que acabou regista-se e avança) e manda partidas prontas para a fila,
    até `cap` ao mesmo tempo (partidas da mesma ronda são independentes)."""
    with LOCK, db() as con:
        # partidas em jogo ao mesmo tempo, somando todos os torneios (definição «jogos do Forge ao mesmo tempo»); antes de o
        # simulador arrancar lê-se do ficheiro, senão o 1.º passo depois de reiniciar mandava só uma
        inflight, cap = 0, max(1, sim.PAR["n"] if sim._worker else sim.load_parallel(DATA))
        rows = con.execute("SELECT id, status, state, owner FROM tournaments WHERE status IN ('running', 'paused') ORDER BY ts").fetchall()
        tours = [(tid, status, json.loads(s), owner) for tid, status, s, owner in rows]
        for tid, status, st, owner in tours:
            for m in [m for m in st["matches"] if m.get("job")]:
                j, was = sim.status(m["job"]), m["st"]
                if j and j["status"] in ("queued", "running"):
                    inflight += 1
                    continue
                if j is None:  # o servidor reiniciou: o trabalho perdeu-se, volta à fila
                    pass
                elif j["status"] == "done":
                    for g in j["games"]:
                        gid = con.execute("INSERT INTO tournament_games (tid, ts, game) VALUES (?,?,?)", (tid, time.time(), zlib.compress(
                            json.dumps({**g, "match": m["id"], "seats": m["seats"], "unknown": j.get("unknown")}, ensure_ascii=False).encode(), 6))).lastrowid
                        if m["st"] != "done":
                            record(st, m, g, gid)
                else:
                    m["err"] = m.get("err", 0) + 1
                    m["error"] = j.get("error")
                    if m["err"] >= MAX_ERRORS:
                        decide(st, m, f"O Forge falhou {m['err']}×: {j.get('error')}")
                m.pop("job")
                m.pop("seats", None)
                m.pop("sb", None)
                if was != "done" and m["st"] == "done":
                    rate(con, tid, st, m, owner)
                resolve(st)
                save(con, tid, st)
                return
        if BUSY():
            return
        for tid, status, st, owner in tours:
            if status != "running" or not started(st):
                continue
            while inflight < cap:
                m = next_match(st)
                if not m:
                    if not any(x.get("job") for x in st["matches"]):
                        resolve(st)  # não devia acontecer; fecha o torneio se já tem campeão
                        save(con, tid, st, None if st.get("champion") is not None else "error")
                    break
                seats = seats_for(m)
                m["sb"], decks = {}, {}
                for i in seats:
                    sw = []
                    if len(seats) == 2 and side_ok(st, i):
                        try:
                            sw = sideboard(con, tid, owner, st, m, i)
                        except Exception as e:  # o sideboard é um extra: sem ele joga a lista base
                            print(f"[torneio {tid}] sideboard: {e!r}", file=sys.stderr, flush=True)
                    if sw:
                        m["sb"][str(i)] = sw
                    decks[i] = apply_swaps(st["decks"][i], sw) if sw else st["decks"][i]
                cmd = sim.GAME_TYPE.get(st["format"], "Constructed") != "Constructed"
                body = {"format": st["format"], "casual": st.get("casual"), "mode": {2: "1v1", 3: "ffa3", 4: "ffa4"}[len(seats)], "games": 1,
                        "clock": (1500 if cmd else 900) if len(seats) > 2 else (600 if cmd else 300),
                        "seats": [{"deck": decks[i], "difficulty": st["players"][i]["difficulty"]} for i in seats]}
                try:
                    m["job"], m["seats"] = sim.submit(DATA, body), seats
                except ValueError as e:
                    st["error"] = str(e)
                    save(con, tid, st, "error")
                    break
                st.pop("error", None)
                save(con, tid, st)
                inflight += 1
            if inflight >= cap:
                return


def runner():
    while True:
        try:
            step()
        except Exception as e:  # um torneio estragado não pode parar os outros
            print(f"[torneio] {e!r}", file=sys.stderr, flush=True)
        time.sleep(2)


def init(data_dir, busy=None):
    global DATA, DB, BUSY
    DATA, DB = data_dir, os.path.join(data_dir, "grimorio.db")
    BUSY = busy or BUSY
    db().close()
    threading.Thread(target=runner, daemon=True).start()


# ---------- verificação ----------

def bets_selfcheck(rng):
    """Odds pelo Elo, campeão por Monte Carlo e liquidação (ganha, perde, devolve), numa base temporária."""
    global DB
    import tempfile
    assert abs(win_probs({"p": [0, 1]}, [1700, 1500])[0] - 1 / (1 + 10 ** (-200 / 400))) < 1e-12  # = ratings.expected()
    assert (to_odds(0.5), to_odds(0.99), to_odds(0.001), to_odds(0)) == (1.9, 1.05, 50.0, 50.0)
    st = build("elim", 4)
    st.update(format="modern", players=[{"name": f"D{i}", "src": "meta", "ref": f"modern-{i}"} for i in range(4)])
    ps = champ_probs(st, [1800, 1500, 1500, 1200], 600, rng)
    assert abs(sum(ps) - 1) < 1e-9 and ps[0] == max(ps) and ps[3] == min(ps), ps
    old, DB = DB, os.path.join(tempfile.mkdtemp(), "t.db")
    try:
        with db() as con:
            r1 = [m for m in st["matches"] if m["r"] == 1]
            place(con, "x", "t1", "running", st, {"kind": "champ", "pick": 0, "stake": 100})
            place(con, "x", "t1", "running", st, {"kind": "match", "mid": r1[0]["id"], "pick": r1[0]["p"][0], "stake": 50})
            place(con, "x", "t1", "running", st, {"kind": "match", "mid": r1[1]["id"], "pick": r1[1]["p"][0], "stake": 50})
            assert wallet(con, "x")["coins"] == 800
            for bad in ({"kind": "champ", "pick": 0, "stake": 801}, {"kind": "match", "mid": "nope", "pick": 0, "stake": 1}, {"kind": "champ", "pick": 9, "stake": 1}):
                try:
                    place(con, "x", "t1", "running", st, bad)
                    raise AssertionError(bad)
                except ValueError:
                    pass
            o = {b[0]: b[1] for b in con.execute("SELECT mid, odds FROM bets")}
            gone = {**st, "matches": json.loads(json.dumps(st["matches"]))}
            m0 = next(m for m in gone["matches"] if m["r"] == 1)
            m0.update(st="done", win=m0["p"][0], lose=m0["p"][1])
            resolve(gone)
            try:
                place(con, "x", "t3", "running", gone, {"kind": "champ", "pick": m0["p"][1], "stake": 1})
                raise AssertionError("aposta num eliminado")
            except ValueError:
                pass
            r1[0].update(st="done", win=r1[0]["p"][0], lose=r1[0]["p"][1])  # ganha
            r1[1].update(st="done", win=None)  # empate: devolve
            settle(con, "t1", st)
            assert wallet(con, "x")["coins"] == 800 + round(50 * o[r1[0]["id"]]) + 50
            st["champion"] = 1  # o campeão foi outro: perde
            settle(con, "t1", st)
            assert [r[0] for r in con.execute("SELECT status FROM bets ORDER BY id")] == ["lost", "won", "refund"]
            place(con, "x", "t2", "running", build("elim", 4) | {"players": st["players"], "format": "modern"}, {"kind": "champ", "pick": 2, "stake": 30})
            before = wallet(con, "x")["coins"]
            settle(con, "t2", {"matches": []}, cancelled=True)
            assert wallet(con, "x")["coins"] == before + 30
            con.execute("UPDATE wallets SET coins=10 WHERE owner='x'")
            assert wallet(con, "x", top=True) == {"coins": SUBSIDY, "subsidy": True} and wallet(con, "x", top=True)["coins"] == SUBSIDY
            con.execute("UPDATE wallets SET coins=10 WHERE owner='x'")
            assert wallet(con, "x", top=True)["coins"] == 10  # um subsídio por dia
    finally:
        DB = old


def selfcheck():
    rng = random.Random(7)

    def play(st, pick):
        """Joga o torneio até ao fim; pick(m) -> lugar vencedor (0/1) ou None (empate)."""
        for _ in range(500):
            m = next((m for m in st["matches"] if m["st"] == "ready"), None)
            if not m:
                break
            m["seats"] = seats_for(m)
            k = pick(m)
            if m["b"] == "P":
                order = sorted(m["seats"], key=lambda x: rng.random())
                g = {"winner": sim.SIDES[m["seats"].index(order[0])], "places": [sim.SIDES[m["seats"].index(x)] for x in order]}
            else:
                g = {"winner": "draw" if k is None else sim.SIDES[m["seats"].index(m["p"][k])]}
            record(st, m, g, 0)
            m.pop("seats")
            resolve(st)
        return [m for m in st["matches"] if m["st"] == "done" and not m.get("bye") and not m.get("skip")]

    better = lambda m: 0 if m["p"][0] < m["p"][1] else 1
    # eliminação simples: 5 jogadores -> chave de 8, os 3 primeiros isentos na 1.ª ronda; o melhor seed ganha sempre
    st = build("elim", 5)
    assert [m["p"] for m in st["matches"] if m["r"] == 1] == [[0, None], [3, 4], [1, None], [2, None]]
    assert sum(1 for m in st["matches"] if m.get("bye")) == 3
    played = play(st, better)
    assert len(played) == 4 and st["champion"] == 0, (len(played), st["champion"])
    st = build("elim", 8, third=True)
    played = play(st, better)
    assert len(played) == 8 and st["champion"] == 0
    assert next(m for m in st["matches"] if m["id"] == "3")["win"] == 2  # 3.º lugar: seed 3 contra seed 4
    # empates na eliminação Bo1: repete até MAX_EXTRA; depois ganha o melhor seed
    st = build("elim", 4)
    played = play(st, lambda m: None)
    assert st["champion"] == 0 and all(len(m["g"]) == 1 + MAX_EXTRA and m.get("tb") for m in played)
    # Bo3: acaba aos 2
    st = build("elim", 4, bo=3)
    played = play(st, better)
    assert all(m["w"] in ([2, 0], [0, 2]) and len(m["g"]) == 2 for m in played)
    # dupla eliminação: cada um sai à 2.ª derrota; o campeão tem no máximo 1
    for n in (4, 5, 6, 8, 11, 16):
        for trial in range(30):
            st = build("dupla", n)
            played = play(st, lambda m: rng.randrange(2))
            losses = [0] * n
            for m in played:
                losses[m["lose"]] += 1
            ch = st["champion"]
            assert ch is not None and losses[ch] <= 1, (n, losses, ch)
            assert sorted(losses[i] for i in range(n) if i != ch) == [2] * (n - 1), (n, losses)
            assert 2 * n - 2 <= len(played) <= 2 * n - 1
            w1 = {frozenset(m["p"]) for m in played if m["b"] == "W" and m["r"] == 1}
            assert n == 4 or not any(frozenset(m["p"]) in w1 for m in played if m["id"].startswith("L2-")), (n, "repetição logo a seguir")
    st = build("dupla", 4)
    play(st, lambda m: 0 if m["id"] != "GF" else 1)  # o vindo dos vencidos ganha a 1.ª final: há 2.ª
    assert not next(m for m in st["matches"] if m["id"] == "GF2").get("skip")
    # suíço: sem repetir adversários, um jogo por ronda, isento só uma vez
    for n in (4, 7, 8, 13):
        st = build("suico", n, rounds=3)
        play(st, lambda m: rng.choice([0, 1, None]))
        pairs, byes = set(), []
        for r in (1, 2, 3):
            ms = [m for m in st["matches"] if m["r"] == r]
            seen = [x for m in ms for x in m["p"] if x is not None]
            assert sorted(seen) == list(range(n)), (n, r, seen)
            for m in ms:
                if m.get("bye"):
                    byes.append(m["win"])
                else:
                    pr = frozenset(m["p"])
                    assert pr not in pairs, ("repetição", n, m)
                    pairs.add(pr)
        assert len(byes) == len(set(byes)) == (3 if n % 2 else 0)
        tab = standings(st)
        assert st["champion"] == tab[0]["i"] and sum(t["pts"] for t in tab) <= 3 * (3 * (n // 2) + (n % 2) * 3)
    # liga: cada par uma só vez, ninguém joga duas vezes na mesma ronda
    for n in (4, 5, 6, 9):
        st = build("liga", n)
        pr = [frozenset(m["p"]) for m in st["matches"]]
        assert len(pr) == len(set(pr)) == n * (n - 1) // 2
        for r in {m["r"] for m in st["matches"]}:
            xs = [x for m in st["matches"] if m["r"] == r for x in m["p"]]
            assert len(xs) == len(set(xs))
        play(st, lambda m: rng.choice([0, 1, None]))
        assert st["champion"] is not None
    # mesas: tamanhos 2–4, pontos 3/2/1/0 pelo lugar
    for n, sizes in ((4, [4]), (5, [3, 2]), (7, [4, 3]), (10, [4, 3, 3]), (16, [4, 4, 4, 4])):
        st = build("mesas", n, rounds=3)
        assert [len(m["p"]) for m in st["matches"]] == sizes, (n, [m["p"] for m in st["matches"]])
        play(st, lambda m: None)
        assert len({m["r"] for m in st["matches"]}) == 3 and st["champion"] == standings(st)[0]["i"]
    st = build("mesas", 4, rounds=1)
    m = st["matches"][0]
    m["seats"] = seats_for(m)
    record(st, m, {"winner": "c", "places": ["c", "a", "d", "b"]}, 0)
    resolve(st)
    assert m["pl"] == [2, 0, 3, 1] and [t["pts"] for t in sorted(standings(st), key=lambda t: t["i"])] == [2, 0, 3, 1]
    assert st["champion"] == 2
    # pódio e lugares: com 3.º lugar 1/2/3/4 e 5.º–8.º; sem ele os dois das meias empatam em 3.º
    st = build("elim", 8, third=True)
    st["players"], st["me"] = [{"name": f"D{i}", "src": "meta", "ref": str(i)} for i in range(8)], 7
    assert me_state(st) == {"phase": "in", "match": "W1-1"}
    play(st, better)
    rk = ranking(st)
    assert [rk[i] for i in range(5)] == [[1, 1], [2, 2], [3, 3], [4, 4], [5, 8]] and rk[7] == [5, 8], rk
    assert me_state(st) == {"phase": "done", "place": [5, 8]}
    assert [(x["i"], x["place"]) for x in podium(st)] == [(0, 1), (1, 2), (2, 3)] and "me" not in podium(st)[0]
    st = build("elim", 8)
    st["players"], st["me"] = [{"name": f"D{i}", "src": "meta", "ref": str(i)} for i in range(8)], 7
    m = st["matches"][0]  # W1-1: 0 contra 7; o 7 perde e a chave segue
    m["seats"] = seats_for(m)
    record(st, m, {"winner": sim.SIDES[m["seats"].index(0)]}, 0)
    resolve(st)
    assert me_state(st) == {"phase": "out", "match": "W1-1", "by": 0}
    play(st, better)
    assert [x["place"] for x in podium(st)] == [1, 2, 3, 3]
    st["me"] = 0
    assert me_state(st)["place"] == [1, 1] and podium(st)[0].get("me")
    assert counts_yellow(st) and not counts_yellow({**st, "casual": True})
    assert not counts_yellow({"players": [{"src": "meus"}, {"src": "meus"}]})
    for _ in range(20):  # dupla: 1.º, 2.º e 3.º sem empates
        st = build("dupla", 6)
        st["players"] = [{"name": str(i)} for i in range(6)]
        play(st, lambda m: rng.randrange(2))
        assert [x["place"] for x in podium(st)] == [1, 2, 3] and podium(st)[0]["i"] == st["champion"]
    # sideboard: o adversário lançou artefactos (jogo exato) -> entra o que os destrói; sai o que ficou preso na mão
    C = {"Shatter": {"o": "Destroy target artifact.", "t": "Instant", "mt": "Instant", "cmc": 2, "tg": ["removal"], "kw": []},
         "Fog": {"o": "Prevent all combat damage.", "t": "Instant", "mt": "Instant", "cmc": 1, "tg": [], "kw": []},
         "Bear": {"o": "", "t": "Creature — Bear", "mt": "Creature", "cmc": 2, "tg": [], "kw": []},
         "Dragon": {"o": "Flying", "t": "Creature — Dragon", "mt": "Creature", "cmc": 6, "tg": [], "kw": ["Flying"]},
         "Ornithopter": {"o": "Flying", "t": "Artifact Creature — Thopter", "mt": "Creature", "cmc": 0, "tg": [], "kw": ["Flying"]},
         "Bauble": {"o": "", "t": "Artifact", "mt": "Artifact", "cmc": 0, "tg": [], "kw": []}}
    deck = {"main": {"Bear": 4, "Dragon": 2}, "side": {"Shatter": 3, "Fog": 2}}
    opp = {"main": {"Ornithopter": 4, "Bauble": 4}}
    g = {"exact": True, "winner": "a", "summary": {"b": {"cast": [[1, "Bauble"], [2, "Bauble"], [2, "Ornithopter"]], "damage_by_card": {"Ornithopter": 3}},
                                                   "a": {"used": ["Bear"]}},
         "events": [{"k": "turn", "p": "b", "hd": {"b": ["Bauble"], "a": ["Dragon", "Bear"]}}, {"k": "turn", "p": "b"},
                    {"k": "turn", "p": "b"}, {"k": "turn", "p": "b"}]}
    flip = json.loads(json.dumps(g).replace('"a"', '"X"').replace('"b"', '"a"').replace('"X"', '"b"'))  # o mesmo jogo, lugares trocados
    sw = plan_side(C, deck, opp, [(g, "a", "b")])
    assert sw == plan_side(C, deck, opp, [(flip, "b", "a")])  # os lugares rodam a cada jogo: conta o lado de cada um
    assert [(x["in"], x["out"], x["q"]) for x in sw] == [("Shatter", "Dragon", 2)], sw
    assert "lançou 3 artefactos" in sw[0]["why"] and sw[0]["outWhy"] == "não chegou a ser jogada"
    g["events"] = [{"k": "turn", "p": "a", "hd": {"a": ["Dragon", "Bear"]}}, {"k": "turn", "p": "a"}]
    sw = plan_side(C, deck, opp, [(g, "a", "b")])
    assert sw[0]["outWhy"] == "ficou presa na mão" and stuck_in(g, "a") == ["Dragon"]
    assert "vale menos" in plan_side(C, deck, opp, [(g, "a", "b")], lost={"Shatter"})[0]["why"]
    assert not plan_side(C, deck, {"main": {"Bear": 20}}, [])  # nada a responder: fica a lista base
    d2 = apply_swaps(deck, sw)
    assert d2["main"] == {"Bear": 4, "Shatter": 2} and d2["side"] == {"Shatter": 1, "Fog": 2, "Dragon": 2} and deck["main"]["Dragon"] == 2
    bets_selfcheck(rng)
    assert similarity({"main": {"A": 4, "B": 4}}, {"main": {"A": 4, "B": 4}}) == 1
    assert similarity({"main": {"A": 4, "B": 4}, "commanders": ["C"]}, {"main": {"A": 4, "B": 3, "D": 1}, "commanders": ["C"]}) == 8 / 10
    lg = {"matches": [{"id": "a", "st": "ready", "p": [0, 1], "job": "j1"}, {"id": "b", "st": "ready", "p": [1, 2]}, {"id": "c", "st": "ready", "p": [2, 3]}]}
    assert next_match(lg)["id"] == "c"  # o deck 1 está a jogar: «b» espera, «c» (decks livres) avança
    assert started({"start_at": 0}) and not started({"start_at": time.time() + 9}) and not started({"start_at": 0, "hold": True})
    print("selfcheck ok")


if __name__ == "__main__":
    selfcheck()
