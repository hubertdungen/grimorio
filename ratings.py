"""Grimório — ratings dos decks: vitórias de jogos e de rondas, Elo, estrelas 0–6 e a Arena automática.

Elo jogo a jogo (não por ronda: Bo1 e Bo3 pesam o mesmo por jogo): começa em 1500, K=40 nos primeiros PROV jogos
(provisório) e K=20 depois; esperado = 1/(1+10^((Rb-Ra)/400)); empate vale ½. Uma ronda é uma partida (Bo1 ou Bo3)
e só conta para rondas ganhas/perdidas quando acaba (final=True); o resultado sai de todos os jogos com esse round_id.

Estrelas (0,0–6,0, uma casa decimal) = 6 × a probabilidade de ganhar a um deck médio do formato (Elo 1500), pelo Elo:
3★ = ganha metade, 6★ = ganha (quase) sempre: 97% ou mais; 0★ = perde sempre. É desempenho, não posição na tabela: o melhor deck de
um formato só chega perto de 6 se ganhar quase tudo.
Escalão = ⌊estrelas⌋ (o 6 só leva quem tem 6,0), com ranking dentro do escalão pelo Elo. Sem jogos conta 3,0★ provisório.

Dois ratings por deck: o normal (format = o formato do deck; só jogos legais e não casuais) e o casual (format =
CASUAL, um só grupo para todos os formatos): jogos em modo casual (Laboratório, torneios, Arena) e qualquer jogo de um
deck marcado casual (body.casual, pode violar as regras do formato) — esses decks só têm rating casual.

Chaves: deck:<id> (os meus, com dono) e meta:<id do sim.opponents> (partilhados por todos). Alimentam isto o
Laboratório (from_lab, 1 contra 1), os torneios (record_round) e a Arena automática (thread `arena_loop`), que joga
rondas no Forge sozinha quando ninguém está a usar o simulador (os trabalhos dela vão para o fim da fila do sim).
"""
import contextlib, json, os, random, re, sqlite3, sys, threading, time, uuid, zlib
import sim

PROV, POOL = 10, 8         # jogos até deixar de ser provisório; decks estabelecidos para usar percentis
K_PROV, K = 40, 20
START = 1500.0
TOP = 6.0                  # estrelas máximas
CASUAL = "casual"          # formato do rating casual
META_TOP = 30              # decks do meta por formato que entram nas escolhas ao calhas e na Arena
SAME_TIER = 0.7            # Arena: probabilidade de emparelhar dentro do mesmo escalão
IDLE = 60                  # s sem trabalhos de outros no simulador antes de a Arena jogar
MIN_FREE_MB = 2500         # RAM livre mínima para a Arena arrancar um jogo (o contentor do Forge leva até 3 GB)
DATA = DB = None
BUSY = lambda: False  # noqa: E731 — o server.py diz se há um jogo teu aberto contra o Forge


# ---------- base de dados ----------

def schema(con):
    con.execute("CREATE TABLE IF NOT EXISTS ratings (key TEXT, format TEXT, kind TEXT, owner TEXT, name TEXT, elo REAL,"
                " games INT, wins INT, losses INT, draws INT, rounds INT, round_wins INT, round_losses INT, updated REAL,"
                " PRIMARY KEY (key, format))")
    con.execute("CREATE TABLE IF NOT EXISTS rating_games (id INTEGER PRIMARY KEY, ts REAL, format TEXT, a_key TEXT,"
                " b_key TEXT, winner TEXT, source TEXT, round_id TEXT, a_elo REAL, b_elo REAL)")
    con.execute("CREATE INDEX IF NOT EXISTS rating_games_round ON rating_games (round_id)")
    con.execute("CREATE TABLE IF NOT EXISTS ratings_kv (k TEXT PRIMARY KEY, v TEXT)")
    with contextlib.suppress(sqlite3.OperationalError):  # resumo do jogo (dano por carta) dos jogos da Arena
        con.execute("ALTER TABLE rating_games ADD COLUMN summary TEXT")
    for col in ("a_prog REAL", "b_prog REAL", "prog TEXT"):  # progresso rumo à vitória de cada lado (estrelas vermelhas)
        with contextlib.suppress(sqlite3.OperationalError):
            con.execute(f"ALTER TABLE rating_games ADD COLUMN {col}")
    return con


def db():
    return schema(sqlite3.connect(DB, timeout=15))


# ---------- Elo e registo ----------

def expected(ra, rb):
    return 1 / (1 + 10 ** ((rb - ra) / 400))


def _get(con, fmt, d):
    r = con.execute("SELECT elo, games FROM ratings WHERE key=? AND format=?", (d["key"], fmt)).fetchone()
    if r:
        con.execute("UPDATE ratings SET name=? WHERE key=? AND format=?", (str(d.get("name") or "")[:200], d["key"], fmt))
        return list(r)
    con.execute("INSERT INTO ratings VALUES (?,?,?,?,?,?,0,0,0,0,0,0,0,?)", (d["key"], fmt, d.get("kind") or "meta",
                d.get("owner") or "", str(d.get("name") or "")[:200], START, time.time()))
    return [START, 0]


def casual_deck(con, key):
    """deck:<id> marcado casual no editor (pode violar as regras do formato)."""
    if not key.startswith("deck:"):
        return False
    try:
        r = con.execute("SELECT json_extract(body, '$.casual') FROM decks WHERE id=?", (key[5:],)).fetchone()
    except sqlite3.OperationalError:
        return False
    return bool(r and r[0])


NOT_CASUAL = "key NOT IN (SELECT 'deck:' || id FROM decks WHERE json_extract(body, '$.casual'))"


ROUTES = ("dmg", "psn", "cmd", "mill", "alt")  # vias para ganhar: dano/vida, veneno, dano de comandante, biblioteca, alternativa
CAP = 2.0                  # progresso máximo por jogo (200%: o dobro do necessário)


def progress(g, side, fmt=None):
    """Progresso de `side` rumo à vitória num jogo (dict do sim: winner, reason, events, summary, setup, out?) ->
    {p, dmg, psn, cmd, mill, alt, by}. Por adversário, cada via é a fração do objetivo (o «ou» das vitórias):
    dmg = dano feito ÷ vida inicial (a dois também a vida perdida, vida inicial − final, que apanha drenos e o dano
    a mais: 30 a quem tinha 20 = 1,5); psn = veneno ÷ 10; cmd = dano de combate do melhor comandante ÷ 21; mill =
    cartas tiradas da biblioteca dele para o cemitério ou exílio (mill, exilar do topo; as que ele próprio põe lá
    também contam, é o caminho para ficar sem cartas) ÷ biblioteca inicial (tamanho do deck − 7); alt = 1 se ele perdeu
    por um efeito (vitória alternativa, combo). Quem o eliminou (a dois: quem ganhou) tem a via da razão da derrota ≥ 1.
    Cada via vai até CAP; o do adversário = a melhor via. p = média sobre os adversários (a dois, o único); quem ganha
    tem p ≥ 1. Sem events (resumos antigos) usa damage_by_card/poison_by_card/life do summary (aproximado)."""
    sm, ev, setup = g.get("summary") or {}, g.get("events") or [], g.get("setup") or {}
    sides = [s for s in sim.SIDES if s in sm or s in setup] or ["a", "b"]
    n, opps = len(sides), [s for s in sides if s != side]
    life0 = g.get("startLife") or sim.base_life(str(fmt or "").lower(), n)
    cmdrs, out = set((setup.get(side) or {}).get("commanders") or ()), g.get("out") or {}
    why = lambda o: str((out.get(o) or {}).get("why") or (g.get("reason") if n == 2 else "") or "").lower()  # noqa: E731
    per = []
    for o in opps:
        dmg = psn = mill = 0
        cmd = {}
        for e in ev:
            k, x = e.get("k"), e.get("n") or 0
            if k in ("damage", "poison") and e.get("p") == side and e.get("target") == o:
                if k == "poison" or e.get("psn"):
                    psn += x
                else:
                    dmg += x
                    if e.get("card") in cmdrs and e.get("combat"):
                        cmd[e["card"]] = cmd.get(e["card"], 0) + x
            elif e.get("p") == o and (k == "mill" or k == "exile" and str(e.get("target") or "").startswith("library>")):
                mill += x or 1
        if not ev and n == 2:
            s = sm.get(side) or {}
            dmg, psn = sum((s.get("damage_by_card") or {}).values()), sum((s.get("poison_by_card") or {}).values())
        if n == 2 and sm.get("life"):
            dmg = max(dmg, life0 - sm["life"][-1][sides.index(o)])
        lib0 = max(1, ((setup.get(o) or {}).get("size") or (100 if life0 >= 30 else 60)) - 7)
        r = {"dmg": dmg / life0, "psn": psn / 10, "cmd": max(cmd.values(), default=0) / 21, "mill": mill / lib0, "alt": 0.0}
        if (out.get(o) or {}).get("by") == side or n == 2 and g.get("winner") == side:
            w = why(o)
            via = "psn" if "poison" in w else "mill" if "library" in w else "cmd" if "general" in w or "commander" in w \
                else "dmg" if "life" in w or not w else "alt"
            r[via] = max(r[via], 1.0)
        per.append({k: min(CAP, v) for k, v in r.items()})
    res = {k: round(sum(r[k] for r in per) / len(per), 3) for k in ROUTES}
    p = sum(max(r.values()) for r in per) / len(per)
    res["p"] = round(max(p, 1.0) if g.get("winner") == side else p, 3)
    res["by"] = max(ROUTES, key=lambda k: res[k]) if res["p"] > 0 else None
    return res


def progs_of(g, fmt, sides=("a", "b")):
    """(progresso do 1.º lado, do 2.º) de um jogo, ou None se o jogo não dá (os ratings não podem cair por isto)."""
    try:
        return tuple(progress(g, s, fmt) for s in sides)
    except Exception as e:
        print(f"[ratings] progresso: {e!r}", file=sys.stderr, flush=True)
        return None


def record_round(con, fmt, a, b, games, source, round_id=None, final=True, casual=False, progs=None):
    """a, b = {key, kind ('meu'|'meta'), name, owner}; games = ['a'|'b'|'draw', …] do ponto de vista de a (só os novos).
    Jogos e Elo atualizam-se jogo a jogo; com final=True a ronda fecha com todos os jogos já guardados com este round_id
    (os de chamadas anteriores com final=False incluídos). casual=True (ou um deck casual de um dos lados) -> vai para
    o rating casual (format CASUAL) em vez do do formato. progs = [(progress de a, progress de b) | None, …] alinhado com
    games (ficam em a_prog/b_prog e as vias em prog). Devolve o round_id."""
    rid = str(round_id or uuid.uuid4().hex)[:120]
    if a["key"] == b["key"]:
        return rid
    if casual or casual_deck(con, a["key"]) or casual_deck(con, b["key"]):
        fmt = CASUAL
    ra, rb = _get(con, fmt, a), _get(con, fmt, b)
    for i, w in enumerate(games):
        if w not in ("a", "b", "draw"):
            continue
        pg = (progs or [])[i] if i < len(progs or []) else None
        s = 1.0 if w == "a" else 0.0 if w == "b" else 0.5
        x = expected(ra[0], rb[0])
        ra[0], rb[0] = ra[0] + (K_PROV if ra[1] < PROV else K) * (s - x), rb[0] + (K_PROV if rb[1] < PROV else K) * (x - s)
        ra[1] += 1
        rb[1] += 1
        for d, r, win, loss in ((a, ra, w == "a", w == "b"), (b, rb, w == "b", w == "a")):
            con.execute("UPDATE ratings SET elo=?, games=games+1, wins=wins+?, losses=losses+?, draws=draws+?, updated=?"
                        " WHERE key=? AND format=?", (r[0], win, loss, w == "draw", time.time(), d["key"], fmt))
        con.execute("INSERT INTO rating_games (ts, format, a_key, b_key, winner, source, round_id, a_elo, b_elo, a_prog, b_prog, prog)"
                    " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", (time.time(), fmt, a["key"], b["key"], w, source, rid, ra[0], rb[0],
                                                          *((pg[0]["p"], pg[1]["p"], json.dumps({"a": pg[0], "b": pg[1]})) if pg else (None,) * 3)))
    if final:
        wa = wb = 0
        for ak, w in con.execute("SELECT a_key, winner FROM rating_games WHERE round_id=?", (rid,)):
            if w != "draw":
                wa += (w == "a") == (ak == a["key"])
                wb += (w == "a") != (ak == a["key"])
        if con.execute("SELECT 1 FROM rating_games WHERE round_id=?", (rid,)).fetchone():
            for d, me, op in ((a, wa, wb), (b, wb, wa)):
                con.execute("UPDATE ratings SET rounds=rounds+1, round_wins=round_wins+?, round_losses=round_losses+?"
                            " WHERE key=? AND format=?", (me > op, op > me, d["key"], fmt))
    return rid


def ref(src, ref_id, name, owner):
    """Participante de um torneio ({src: 'meus'|'meta', ref}) -> lado para record_round."""
    return {"key": ("deck:" if src == "meus" else "meta:") + str(ref_id), "kind": "meu" if src == "meus" else "meta",
            "name": name, "owner": owner if src == "meus" else ""}


def from_lab(con, d, owner):
    """POST /api/sim/record de 1 contra 1: o deck contra opp_key (meta:<id> ou deck:<id>, listas coladas e o espelho
    não contam). `bo` diz quando a série acaba: ganha quem passa de bo//2 ou ao fim de bo jogos; casual=True (modo
    casual do Laboratório) -> rating casual."""
    key, did = str(d.get("opp_key") or ""), str(d.get("deck_id") or "")
    if not did or d.get("winner") not in ("a", "b", "draw") or not re.fullmatch(r"(meta|deck):[a-z0-9-]{1,130}", key):
        return
    mine = lambda i: con.execute("SELECT name FROM decks WHERE id=? AND owner=? AND deleted IS NULL", (i, owner)).fetchone()  # noqa: E731
    r, fmt = mine(did), str(d.get("format") or "").lower()[:40]
    if not r:
        return
    a = {"key": "deck:" + did, "kind": "meu", "name": r[0], "owner": owner}
    if key.startswith("deck:"):
        r = mine(key[5:])
        if not r:
            return
        b = {"key": key, "kind": "meu", "name": r[0], "owner": owner}
    else:
        b = {"key": key, "kind": "meta", "name": str(d.get("opp_name") or key)[:200], "owner": ""}
    rid = f"lab:{did}:{str(d.get('match_id') or uuid.uuid4().hex)[:60]}"  # um deck casual vai sempre para o casual
    ws = [w if ak == a["key"] or w == "draw" else "ab"[w == "a"] for ak, w in
          con.execute("SELECT a_key, winner FROM rating_games WHERE round_id=?", (rid,))] + [d["winner"]]
    bo = max(1, min(9, int(d.get("bo") or 1)))
    # progresso: o jogo inteiro do trabalho do sim (ainda em memória, 1 h) ou, sem ele, o resumo que o Lab manda
    j = sim.status(str(d.get("job") or "")) if d.get("job") else None
    g = next((x for x in (j or {}).get("games") or () if x.get("winner") == d["winner"]), None) or {"winner": d["winner"], "summary": d["summary"] if isinstance(d.get("summary"), dict) else {}}
    if isinstance(d.get("start_life"), int) and d["start_life"] > 0:
        g = {**g, "startLife": d["start_life"]}
    record_round(con, fmt, a, b, [d["winner"]], "lab", rid, progs=[progs_of(g, fmt)],
                 final=max(ws.count("a"), ws.count("b")) > bo // 2 or len(ws) >= bo, casual=bool(d.get("casual")))


# ---------- estrelas, tabela e escolhas ----------

TOP_P = 0.97  # a partir daqui conta como «ganha sempre»: 6★


def stars(elo, dist=None):
    """Elo -> 0,0–6,0: 6 × P(ganhar a um deck de Elo médio) (ver o topo do ficheiro). `dist` já não conta (chamadas antigas)."""
    p = expected(elo, START)
    return TOP if p >= TOP_P else min(round(TOP * p, 1), TOP - 0.1)  # 6★ = quase sempre (≥ 97%); abaixo, 6 × P


def dist(con, fmt):
    return [r[0] for r in con.execute("SELECT elo FROM ratings WHERE format=? AND games>=?", (fmt, PROV))]


VISIBLE = ("(kind='meta' OR (owner=? AND key IN (SELECT 'deck:' || id FROM decks WHERE owner=? AND deleted IS NULL)))")
COLS = ("key", "format", "kind", "owner", "name", "elo", "games", "wins", "losses", "draws", "rounds", "round_wins", "round_losses", "updated")


def table(con, fmt, owner):
    """Decks do meta + os meus (que ainda existem) deste formato, do melhor para o pior, com estrelas e escalões.
    fmt "all" = todos os formatos normais juntos (cada um com as estrelas do seu formato); CASUAL = o rating casual.
    Os decks casuais só aparecem no casual."""
    where = f"format!='{CASUAL}' AND {NOT_CASUAL}" if fmt == "all" else "format=?" if fmt == CASUAL else f"format=? AND {NOT_CASUAL}"
    rows = [dict(zip(COLS, r)) for r in con.execute(f"SELECT {', '.join(COLS)} FROM ratings WHERE {where} AND games>0 AND {VISIBLE}",
                                                    ((fmt,) if fmt != "all" else ()) + (owner, owner))]
    dists, seen, ly = {}, {}, layers(con)
    for r in rows:
        r["stars"] = stars(r["elo"], dists.setdefault(r["format"], dist(con, r["format"])))
        r.update(ly.get(r["key"], {}))
    com = {f"deck:{i}" for (i,) in con.execute("SELECT id FROM decks WHERE owner=? AND json_extract(body, '$.community')", (owner,))}
    frs = {f"deck:{i}": n for i, n in con.execute("SELECT id, json_extract(body, '$.friendName') FROM decks WHERE owner=? AND json_extract(body, '$.friend') IS NOT NULL", (owner,))}
    for r in rows:
        r["community"] = r["key"] in com and r["key"] not in frs  # deck guardado mas de outros (comunidade)
        if r["key"] in frs:
            r["friend"] = frs[r["key"]] or "?"  # de um amigo convidado
    rows.sort(key=lambda r: (-r["stars"], -r["elo"]))
    for i, r in enumerate(rows):
        r["elo"] = round(r["elo"], 1)
        r["tier"] = int(r["stars"])
        r["rank"], r["provisional"] = i + 1, r["games"] < PROV
        seen[r["tier"]] = r["rank_in_tier"] = seen.get(r["tier"], 0) + 1
        r["win_pct"] = round(100 * (r["wins"] + r["draws"] / 2) / r["games"], 1)
        r["round_pct"] = round(100 * r["round_wins"] / r["rounds"], 1) if r["rounds"] else None
    return rows


def goal_stars(p):
    """Progresso médio rumo à vitória -> estrelas vermelhas: linear, 100% = 3★, 200% = 6★ (0% = 0★). Acima de 3★ só fica
    quem passa do objetivo — dano, veneno ou mill a mais depois de já ter o suficiente para ganhar."""
    return round(min(TOP, 3 * max(0.0, p)), 1)


def reset(con, key):
    """O deck mudou mais de 10% da lista com que ganhou os ratings (server.py, ao gravar): recomeça do zero. Apaga o
    amarelo e o casual (linhas de `ratings`) e marca a hora: os jogos de antes ficam na história e continuam a contar
    para os adversários, mas para este deck passam a ser de «key@antes» (azul e vermelho em layers(), Elo em history())."""
    con.execute("DELETE FROM ratings WHERE key=?", (key,))
    kv(con, f"reset:{key}", time.time())


def resets(con):
    """{chave: hora do último recomeço}."""
    return {k[6:]: json.loads(v) for k, v in con.execute("SELECT k, v FROM ratings_kv WHERE k LIKE 'reset:%'")}


def rated(con, key):
    """O deck tem algum rating (normal ou casual) desde o último recomeço."""
    return con.execute("SELECT 1 FROM ratings WHERE key=? AND games>0 LIMIT 1", (key,)).fetchone() is not None


def layers(con):
    """{chave: {blue, blue_elo, blue_games, red, red_games, goal, routes}}: as camadas por cima do rating normal.
    Azul = Elo com TODOS os jogos (normais e casuais de todos os formatos num só Elo, as mesmas regras de K), refeito a
    partir de rating_games; as estrelas usam a mesma escala fixa do Elo (antes: o percentil no formato «de casa» (o
    formato normal com mais jogos; os só casuais ficam no grupo casual), por isso sem jogos casuais azul = amarelo.
    Vermelho = média do progresso rumo à vitória (a_prog/b_prog, todos os jogos, casuais incluídos: é desempenho)
    -> goal_stars; routes = média de cada via e `by` = em quantos jogos ganhos cada via foi a que decidiu."""
    # ponytail: refaz o Elo todo a cada pedido (~1 ms por mil jogos); guardar numa tabela se passar das centenas de milhares
    elo, out, R = {}, {}, resets(con)
    for ts, ak, bk, w, pa, pb, pj in con.execute("SELECT ts, a_key, b_key, winner, a_prog, b_prog, prog FROM rating_games ORDER BY id"):
        ak, bk = (k + "@antes" if k in R and ts < R[k] else k for k in (ak, bk))  # jogos de antes de um recomeço
        ra, rb = elo.setdefault(ak, [START, 0]), elo.setdefault(bk, [START, 0])
        s = 1.0 if w == "a" else 0.0 if w == "b" else 0.5
        x = expected(ra[0], rb[0])
        ra[0], rb[0] = ra[0] + (K_PROV if ra[1] < PROV else K) * (s - x), rb[0] + (K_PROV if rb[1] < PROV else K) * (x - s)
        ra[1], rb[1] = ra[1] + 1, rb[1] + 1
        rt = json.loads(pj) if pj else {}
        for k, p, me, won in ((ak, pa, "a", w == "a"), (bk, pb, "b", w == "b")):
            if p is None:
                continue
            o = out.setdefault(k, {"n": 0, "sum": 0.0, "routes": dict.fromkeys(ROUTES, 0.0), "by": {}})
            o["n"], o["sum"] = o["n"] + 1, o["sum"] + p
            r = rt.get(me) or {}
            for q in ROUTES:
                o["routes"][q] += r.get(q) or 0
            if won and r.get("by"):
                o["by"][r["by"]] = o["by"].get(r["by"], 0) + 1
    home = {}
    for k, f, _ in con.execute(f"SELECT key, format, games FROM ratings WHERE format!='{CASUAL}' ORDER BY games"):
        home[k] = f
    pools = {}
    for k, (e, n) in elo.items():
        if n >= PROV:
            pools.setdefault(home.get(k, CASUAL), []).append(e)
    res = {}
    for k, (e, n) in elo.items():
        o = out.get(k)
        res[k] = {"blue": stars(e, pools.get(home.get(k, CASUAL), [])), "blue_elo": round(e), "blue_games": n,
                  **({"red": goal_stars(o["sum"] / o["n"]), "red_games": o["n"], "goal": round(o["sum"] / o["n"], 3),
                      "routes": {q: round(v / o["n"], 3) for q, v in o["routes"].items()}, "by": o["by"]} if o else {})}
    return res


def all_stars(con, owner):
    """{chave: {stars, prov, elo, games, format, blue, red, goal, routes…}} de tudo o que tenho visível (caixas da
    Biblioteca, listas do Lab); o rating casual vem em «chave|casual» e os decks casuais só têm esse. blue/red/… são
    os de layers() (iguais nas duas entradas da mesma chave)."""
    out, dists, ly = {}, {}, layers(con)
    for key, fmt, elo, games in con.execute(f"SELECT key, format, elo, games FROM ratings WHERE games>0 AND {VISIBLE}"
                                            f" AND (format='{CASUAL}' OR {NOT_CASUAL})", (owner, owner)):
        ds = dists.setdefault(fmt, dist(con, fmt))
        out[key if key not in out and fmt != CASUAL else f"{key}|{fmt}"] = {"stars": stars(elo, ds), "prov": games < PROV, "elo": round(elo),
                                                          "games": games, "format": fmt, **ly.get(key, {})}
    return out


def candidates(con, fmt, owner, sources=("meu", "meta")):
    """sources ⊆ {meu, ami, com, meta}: ami = decks de amigos convidados (body.friend), com = da comunidade (de outros, importados). Decks que podem ser
    escolhidos: os meus deste formato (sem os casuais) e os do meta (sim.opponents), com rating
    ou 3,0★ provisório. fmt CASUAL = todos os meus (casuais incluídos) e o meta de todos os formatos, com o rating
    casual; `format` = o formato do próprio deck."""
    out, cas = [], fmt == CASUAL
    if {"meu", "ami", "com"} & set(sources):  # decks guardados: os meus, dos amigos (body.friend) e da comunidade, tipo «meu»
        out += [{"key": f"deck:{i}", "kind": "meu", "src": "meus", "ref": i, "name": n, "owner": owner, "format": f, "com": bool(com) and not fr,
                 **({"friend": fr} if fr else {})}
                for i, n, f, c, com, fr in con.execute("SELECT id, name, lower(format), json_extract(body, '$.casual'),"
                                                       " json_extract(body, '$.community'), json_extract(body, '$.friend') FROM decks WHERE owner=? AND deleted IS NULL", (owner,))
                if (cas or f == fmt and not c) and ("ami" if fr else "com" if com else "meu") in sources]
    if "meta" in sources:
        for f in sim.META_FORMATS + ("commander",) if cas else (fmt,):
            try:
                os_ = sim.opponents(DATA, f, top=META_TOP)
            except Exception:  # o EDHREC sem rede e sem cache
                os_ = []
            out += [{"key": f"meta:{o['id']}", "kind": "meta", "src": "meta", "ref": o["id"], "name": o["name"], "owner": "",
                     "format": f} for o in os_]
    ds = dist(con, fmt)
    for c in out:
        r = con.execute("SELECT elo, games FROM ratings WHERE key=? AND format=?", (c["key"], fmt)).fetchone()
        elo, games = r if r and r[1] else (START, 0)
        c.update(elo=round(elo, 1), games=games, stars=stars(elo, ds) if games else TOP / 2, provisional=games < PROV)
        c["tier"] = int(c["stars"])
    return out


def pick(con, fmt, owner, n, min_stars=0.0, max_stars=TOP, sources=("meu", "meta"), rng=random):
    """n decks ao calhas com estrelas entre min e max (inclusive): [{key, kind, src, ref, name, stars, elo, …}]."""
    c = [x for x in candidates(con, fmt, owner, sources) if min_stars <= x["stars"] <= max_stars]
    return rng.sample(c, min(max(0, int(n)), len(c)))


def history(con, key, fmt):
    """Rondas (as mais recentes primeiro) e a curva do Elo de um deck."""
    names = dict(con.execute("SELECT key, name FROM ratings WHERE format=?", (fmt,)))
    elo, rounds = [START], {}
    for ts, ak, bk, w, src, rid, ae, be in con.execute(
            "SELECT ts, a_key, b_key, winner, source, round_id, a_elo, b_elo FROM rating_games WHERE format=?"
            " AND (a_key=? OR b_key=?) AND ts>=? ORDER BY id", (fmt, key, key, resets(con).get(key, 0))):
        me = ak == key
        elo.append(round(ae if me else be, 1))
        opp = bk if me else ak
        r = rounds.setdefault(rid, {"round_id": rid, "ts": ts, "source": src, "opp": opp, "opp_name": names.get(opp, opp),
                                    "w": 0, "l": 0, "d": 0})
        r["ts"] = ts
        r["d" if w == "draw" else "w" if (w == "a") == me else "l"] += 1
    return {"elo": elo, "rounds": list(rounds.values())[::-1][:40]}


def deck_info(con, rows, owner):
    """Capa e cores no browser: lista de cartas dos meus decks (decks) e dos do meta (sim.opponent)."""
    for r in rows:
        try:
            if r["key"].startswith("deck:"):
                x = con.execute("SELECT body FROM decks WHERE id=? AND owner=?", (r["key"][5:], owner)).fetchone()
                d = json.loads(x[0]) if x else {}
            else:
                d = sim.opponent(DATA, r["key"][5:]) or {}
        except (ValueError, OSError):
            d = {}
        r["deck"] = {k: d.get(k) for k in ("cover", "commanders", "seeds", "main")}
        r["deck_format"] = str(d.get("format") or r["key"][5:].split("-")[0].replace("edhrec", "commander")).lower()
    return rows


def deck_record(con, did, owner):
    """Análise › registo de um deck meu: por adversário V-D-E, dano médio feito e levado, cartas que mais dano fazem
    (e em quantas vitórias foram a que mais fez) e as dos adversários que mais doem. Fontes sem duplicar: Laboratório
    (sim_games), torneios (tournament_games, os casuais e as mesas incluídos) e Arena (rating_games; os jogos do Lab e
    dos torneios também lá estão, por isso daí só se lê a Arena). Dano levado só nos jogos a dois."""
    if not con.execute("SELECT 1 FROM decks WHERE id=? AND owner=?", (did, owner)).fetchone():
        return None
    games = []  # (fonte, adversário, 'w'|'l'|'d', resumo meu, resumos dos adversários)
    for opp, w, sm in con.execute("SELECT opp_name, winner, summary FROM sim_games WHERE deck_id=?", (did,)):
        sm = json.loads(sm or "{}")
        games.append(("lab", opp or "?", "w" if w == "a" else "d" if w == "draw" else "l", sm.get("a"),
                      [v for k, v in sm.items() if k in "bcd"]))
    with contextlib.suppress(sqlite3.OperationalError):  # sem a tabela dos torneios
        for tid, st in con.execute("SELECT id, state FROM tournaments WHERE owner=?", (owner,)).fetchall():
            ps = json.loads(st).get("players") or []
            me = {i for i, p in enumerate(ps) if p.get("src") == "meus" and str(p.get("ref")) == did}
            if not me:
                continue
            for (blob,) in con.execute("SELECT game FROM tournament_games WHERE tid=?", (tid,)):
                g = json.loads(zlib.decompress(blob))
                seats, sm = g.get("seats") or [], g.get("summary") or {}
                mine = [k for k, i in enumerate(seats) if i in me]
                if g.get("crashed") or len(mine) != 1:
                    continue
                side, others = sim.SIDES[mine[0]], [k for k in range(len(seats)) if k != mine[0]]
                opp = " · ".join(ps[seats[k]]["name"].split(" (")[0] for k in others)
                w = g.get("winner")
                games.append(("torneio", opp, "w" if w == side else "d" if w in (None, "draw") else "l", sm.get(side),
                              [sm.get(sim.SIDES[k]) for k in others if sm.get(sim.SIDES[k])]))
    key, names = "deck:" + did, dict(con.execute("SELECT key, name FROM ratings"))
    for ak, bk, w, sm in con.execute("SELECT a_key, b_key, winner, summary FROM rating_games WHERE source='arena'"
                                     " AND (a_key=? OR b_key=?)", (key, key)):
        me, sm = "a" if ak == key else "b", json.loads(sm or "{}")
        op = "b" if me == "a" else "a"
        games.append(("arena", names.get(bk if me == "a" else ak, "?"), "d" if w == "draw" else "w" if w == me else "l",
                      sm.get(me), [sm[op]] if sm.get(op) else []))
    opp, cards, hurt, dealt, taken, src, wld = {}, {}, {}, [], [], {}, {}
    tot = lambda s: sum((s.get("damage_by_card") or {}).values()) + sum((s.get("poison_by_card") or {}).values())  # noqa: E731
    for so, name, r, s, os_ in games:
        o = opp.setdefault(name, {"name": name, "w": 0, "l": 0, "d": 0, "src": []})
        o[r] += 1
        o["src"] += [so] if so not in o["src"] else []
        src[so] = src.get(so, 0) + 1
        wld.setdefault(so, {"w": 0, "l": 0, "d": 0})[r] += 1
        if s:
            dealt.append(tot(s))
            dm = s.get("damage_by_card") or {}
            for c, n in {**(s.get("poison_by_card") or {}), **dm}.items():
                x = cards.setdefault(c, {"card": c, "dmg": 0, "games": 0, "top_wins": 0})
                x["dmg"] += n
                x["games"] += 1
            if r == "w" and dm:
                cards[max(dm, key=dm.get)]["top_wins"] += 1
        if s and len(os_) == 1:
            taken.append(tot(os_[0]))
            for c, n in (os_[0].get("damage_by_card") or {}).items():
                hurt[c] = hurt.get(c, 0) + n
    avg = lambda v: round(sum(v) / len(v), 1) if v else None  # noqa: E731
    return {"games": len(games), "w": sum(g[2] == "w" for g in games), "l": sum(g[2] == "l" for g in games),
            "d": sum(g[2] == "d" for g in games), "by_source": src, "by_source_wld": wld, "dealt": avg(dealt), "taken": avg(taken),
            "with_dmg": len(dealt), "opponents": sorted(opp.values(), key=lambda o: -(o["w"] + o["l"] + o["d"])),
            "cards": sorted(cards.values(), key=lambda x: -x["dmg"])[:12],
            "hurt": [{"card": c, "dmg": n} for c, n in sorted(hurt.items(), key=lambda x: -x[1])[:8]],
            "rating": (lambda st: st.get(key) or st.get(f"{key}|{CASUAL}"))(all_stars(con, owner))}  # as três camadas de estrelas e as vias do vermelho


# ---------- Arena automática ----------

ARENA = {"on": False, "owner": "", "sources": ["meu", "meta"], "formats": ["pauper"], "min": 0.0, "max": TOP, "bo": 1,
         "difficulty": "default", "difficulty_mine": "", "pause": 30, "max_rounds": 0, "per_hour": 20, "casual": False}
ST = {"state": "", "job": None, "error": None, "since": 0.0, "seen": 0.0, "last_end": 0.0, "secs": []}
ALOCK = threading.RLock()


def kv(con, k, v=None):
    if v is None:
        r = con.execute("SELECT v FROM ratings_kv WHERE k=?", (k,)).fetchone()
        return json.loads(r[0]) if r else None
    con.execute("INSERT OR REPLACE INTO ratings_kv VALUES (?,?)", (k, json.dumps(v, ensure_ascii=False)))


def settings(con):
    s = kv(con, "arena") or {}
    if "casual" not in s and s.get("max") == 5.0:  # guardado na escala antiga de 0–5
        s["max"] = TOP
    return {**ARENA, **s}


def free_mb():
    try:
        with open("/proc/meminfo") as f:
            return int(next(l for l in f if l.startswith("MemAvailable")).split()[1]) // 1024
    except (OSError, StopIteration, ValueError):
        return 1 << 20


def together():
    """A Arena joga durante os torneios (Definições › Jogos do Forge): fica com um dos lugares do simulador."""
    sch = sim.PAR.get("sched") or {}
    return bool(sch.get("arena")) and sim.PAR["n"] > 1


def others_busy():
    """Alguém mais quer o Forge: jogo teu aberto ou trabalhos que não são da Arena na fila/a jogar. Com a Arena a jogar
    durante os torneios, só o jogo teu a obriga a parar (os torneios deixam-lhe um lugar)."""
    if BUSY():
        return "Há um jogo teu aberto contra o Forge."
    if together():
        return None
    with sim.LOCK:
        if any(j["status"] in ("queued", "running") for jid, j in sim.JOBS.items() if jid != ST["job"]):
            ST["seen"] = time.time()
            return "O simulador está a jogar os teus testes ou um torneio."
    return None


def wait_reason(con, cfg):
    r = others_busy()
    if r:
        return r
    if together():  # a jogar ao lado dos torneios: só precisa de um lugar livre no simulador
        if sim.busy_slots() >= sim.PAR["n"]:
            return "Sem lugar livre no simulador."
    else:
        if time.time() - ST["seen"] < IDLE:
            return f"À espera de o simulador estar parado há {IDLE} s."
        try:
            if con.execute("SELECT 1 FROM tournaments WHERE status='running' LIMIT 1").fetchone():
                return "Há um torneio a decorrer."
        except sqlite3.OperationalError:
            pass
    if free_mb() < MIN_FREE_MB:
        return f"Pouca RAM livre ({free_mb()} MB)."
    left = ST["last_end"] + cfg["pause"] - time.time()
    if left > 0:
        return f"Pausa entre rondas ({int(left)} s)."
    hour = con.execute("SELECT COUNT(DISTINCT round_id) FROM rating_games WHERE source='arena' AND ts>?",
                       (time.time() - 3600,)).fetchone()[0]
    if hour >= cfg["per_hour"]:
        return f"Limite de {cfg['per_hour']} rondas por hora."
    return None


def pairing(con, cfg, rng=random):
    """Formato ao calhas entre os escolhidos; A com peso 1/(1+jogos) (os menos jogados primeiro); B do mesmo
    escalão em SAME_TIER das vezes, senão qualquer um do intervalo de estrelas. Casual: um só grupo com os decks de
    todos os formatos escolhidos (e os meus decks casuais desses formatos), com o rating casual; as regras base são as
    do formato do deck A."""
    pools = {}
    for fmt in [CASUAL] if cfg.get("casual") else cfg["formats"]:
        c = [x for x in candidates(con, fmt, cfg["owner"], cfg["sources"]) if cfg["min"] <= x["stars"] <= cfg["max"]
             and x["format"] in cfg["formats"]]
        if len(c) >= 2:
            pools[fmt] = c
    if not pools:
        return None
    fmt = rng.choice(sorted(pools))
    c = pools[fmt]
    a = rng.choices(c, weights=[1 / (1 + x["games"]) for x in c])[0]
    rest = [x for x in c if x["key"] != a["key"]]
    same = [x for x in rest if x["tier"] == a["tier"]]
    b = rng.choice(same if same and rng.random() < SAME_TIER else rest)
    side = lambda x: {k: x[k] for k in ("key", "kind", "src", "ref", "name", "owner", "stars")}  # noqa: E731
    return {"format": fmt, "base": a["format"], "a": side(a), "b": side(b), "games": [], "errors": 0, "bo": cfg["bo"],
            "round_id": "arena:" + uuid.uuid4().hex[:12], "started": time.time()}


def load_deck(con, x):
    if x["kind"] == "meu":
        r = con.execute("SELECT body FROM decks WHERE id=? AND owner=? AND deleted IS NULL", (x["ref"], x["owner"])).fetchone()
        return json.loads(r[0]) if r else None
    return sim.opponent(DATA, x["ref"])


def finish(con, cfg, cur):
    record_round(con, cur["format"], cur["a"], cur["b"], [], "arena", cur["round_id"], final=bool(cur["games"]))
    ST["secs"] = (ST["secs"] + [round(time.time() - cur["started"])])[-20:]
    ST["last_end"] = time.time()
    played = (kv(con, "arena_played") or 0) + 1
    kv(con, "arena_played", played)
    kv(con, "arena_cur", {})
    if cfg["max_rounds"] and played >= cfg["max_rounds"]:
        kv(con, "arena", {**cfg, "on": False})
        ST["state"] = f"Parou sozinha ao fim de {played} rondas."


def arena_step(con):
    """Um passo da Arena (de 2 em 2 s): vê o jogo em curso, regista, e só arranca outro quando ninguém mais precisa
    do Forge. Se aparecer um trabalho teu ou um jogo contra o Forge, o jogo da Arena é cancelado e repete-se depois."""
    cfg, cur = settings(con), kv(con, "arena_cur") or {}
    sim.ARENA_ON["on"] = bool(cfg["on"])
    if ST["job"]:
        j = sim.status(ST["job"])
        if j and j["status"] in ("queued", "running"):
            r = others_busy()
            if r or not cfg["on"]:
                sim.cancel(ST["job"])
                ST.update(job=None, state=f"Jogo cancelado e adiado: {r}" if r else "Desligada.")
            return
        ST["job"] = None
        if not cur:
            return
        if j and j["status"] == "done":
            flip = cur.pop("flip", False)
            ok = [g for g in j["games"] if not g.get("crashed") and g.get("winner") in ("a", "b", "draw")]
            ws = [{"a": "b", "b": "a"}.get(g["winner"], g["winner"]) if flip else g["winner"] for g in ok]
            pr = [progs_of(g, cur.get("base") or cur["format"], ("b", "a") if flip else ("a", "b")) for g in ok]
            record_round(con, cur["format"], cur["a"], cur["b"], ws, "arena", cur["round_id"], final=False, progs=pr)
            g = next((g for g in j["games"] if not g.get("crashed")), None)
            if ws and g and g.get("summary"):  # dano por carta para a análise do deck (Análise › registo)
                sides = ("b", "a") if flip else ("a", "b")
                sm = {k: {x: (g["summary"].get(s) or {}).get(x) or {} for x in ("damage_by_card", "poison_by_card")}
                      for k, s in zip("ab", sides)}
                con.execute("UPDATE rating_games SET summary=? WHERE id=(SELECT max(id) FROM rating_games WHERE round_id=?)",
                            (json.dumps({**sm, "turns": g.get("turns")}, ensure_ascii=False), cur["round_id"]))
            cur["games"] += ws
            cur["errors"] += not ws
        else:
            cur["errors"] += 1
            ST["error"] = (j or {}).get("error") or "O trabalho perdeu-se."
        bo = cur["bo"]
        if max(cur["games"].count("a"), cur["games"].count("b")) > bo // 2 or len(cur["games"]) >= bo or cur["errors"] >= 3:
            finish(con, cfg, cur)
        else:
            kv(con, "arena_cur", cur)
        return
    if not cfg["on"]:
        ST["state"] = ST["state"] if ST["state"].startswith("Parou") else "Desligada."
        return
    r = wait_reason(con, cfg)
    if r:
        ST["state"] = r
        return
    if not cur:
        cur = pairing(con, cfg)
        if not cur:
            ST["state"] = "Não há pelo menos dois decks nos formatos e estrelas escolhidos."
            return
    A, B = load_deck(con, cur["a"]), load_deck(con, cur["b"])
    if not A or not B:
        kv(con, "arena_cur", {})
        ST["error"] = "Um dos decks já não existe; escolho outro par."
        return
    flip = len(cur["games"]) % 2 == 1  # nas séries troca quem começa
    base = cur.get("base") or cur["format"]  # casual: as regras base são as do formato do deck A
    cmd = sim.GAME_TYPE.get(base, "Constructed") != "Constructed"
    # bot dos meus decks (Definições › Bots predefinidos; vazio = o mesmo dos outros)
    mine = lambda k: bool(cfg.get("difficulty_mine")) and k.startswith("deck:") and bool(con.execute(  # noqa: E731
        "SELECT 1 FROM decks WHERE id=? AND owner=?", (k[5:], cfg["owner"])).fetchone())
    da, db = (cfg["difficulty_mine"] if mine(k) else cfg["difficulty"] for k in (cur["a"], cur["b"]))
    seats = [{"deck": d, "difficulty": df} for d, df in (((B, db), (A, da)) if flip else ((A, da), (B, db)))]
    try:  # background: os trabalhos da Arena ficam sempre atrás dos teus na fila do sim
        ST["job"] = sim.submit(DATA, {"format": base, "casual": cur["format"] == CASUAL, "games": 1, "clock": 600 if cmd else 300,
                                      "seats": seats, "background": True})
    except ValueError as e:
        kv(con, "arena_cur", {})
        ST["error"] = f"{cur['a']['name']} contra {cur['b']['name']}: {e}"
        return
    cur["flip"] = flip
    kv(con, "arena_cur", cur)
    ST.update(state="A jogar.", error=None, since=time.time())


def arena_loop():
    con = db()
    while True:
        time.sleep(2)
        try:
            with ALOCK, con:
                arena_step(con)
        except Exception as e:  # um par estragado não pode parar a Arena
            ST["error"] = f"Falha inesperada: {e}"
            print(f"[arena] {e!r}", file=sys.stderr, flush=True)


def arena_status(con, owner):
    cfg, cur = settings(con), kv(con, "arena_cur") or {}
    day = time.mktime(time.localtime()[:3] + (0, 0, 0, 0, 0, -1))
    today = con.execute("SELECT COUNT(DISTINCT round_id) FROM rating_games WHERE source='arena' AND ts>=?", (day,)).fetchone()[0]
    names = {}
    for k, f, n in con.execute("SELECT key, format, name FROM ratings"):
        names[(k, f)] = n
    last = []
    for rid, f, ak, bk, ws, ts in con.execute(
            "SELECT round_id, format, a_key, b_key, group_concat(winner), max(ts) FROM rating_games WHERE source='arena'"
            " GROUP BY round_id ORDER BY max(ts) DESC LIMIT 12"):
        ws = ws.split(",")
        last.append({"format": f, "a": names.get((ak, f), ak), "b": names.get((bk, f), bk), "ts": ts,
                     "wa": ws.count("a"), "wb": ws.count("b"), "draws": ws.count("draw"), "open": rid == cur.get("round_id")})
    j = sim.status(ST["job"]) if ST["job"] else None
    arts = {}  # artes próprias dos meus decks (importadas do site de origem) para o tabuleiro do «ver ao vivo»
    for k in ("a", "b") if cur else ():
        d = cur[k].get("kind") == "meu" and load_deck(con, cur[k])
        if d and (m := sim.art_map(d)):
            arts[k] = m
    return {**{k: cfg[k] for k in ARENA}, "mine": cfg["owner"] in ("", owner), "state": ST["state"], "error": ST["error"],
            "played": kv(con, "arena_played") or 0, "today": today, "last": last,
            "avg_secs": round(sum(ST["secs"]) / len(ST["secs"])) if ST["secs"] else None,
            "cur": cur and {"format": cur["format"], "a": cur["a"]["name"], "b": cur["b"]["name"], "a_stars": cur["a"].get("stars"),
                            "b_stars": cur["b"].get("stars"), "wa": cur["games"].count("a"), "wb": cur["games"].count("b"),
                            "bo": cur["bo"], "base": cur.get("base"), "arts": arts, "job": j and {"id": ST["job"], "status": j["status"], "position": j.get("position"),
                                                           "secs": round(time.time() - ST["since"])}}}


def arena_set(con, owner, d):
    """Guarda as definições; on=True liga (a contagem de rondas desta sessão recomeça), on=False desliga."""
    cfg = settings(con)
    num = lambda v, lo, hi, dflt: max(lo, min(hi, float(v))) if isinstance(v, (int, float)) else dflt  # noqa: E731
    if isinstance(d.get("sources"), list) and set(d["sources"]) <= {"meu", "ami", "com", "meta"} and d["sources"]:
        cfg["sources"] = d["sources"]
    if isinstance(d.get("formats"), list):
        cfg["formats"] = [f for f in d["formats"] if isinstance(f, str) and re.fullmatch(r"[a-z]{2,20}", f)][:12]
    cfg["min"], cfg["max"] = (round(2 * num(d.get(k), 0, TOP, cfg[k])) / 2 for k in ("min", "max"))
    cfg["casual"] = bool(d.get("casual", cfg["casual"]))
    cfg["min"] = min(cfg["min"], cfg["max"])
    cfg["bo"] = 3 if d.get("bo", cfg["bo"]) == 3 else 1
    if d.get("difficulty") in {x[0] for x in sim.DIFFICULTIES}:
        cfg["difficulty"] = d["difficulty"]
    if d.get("difficulty_mine") == "" or d.get("difficulty_mine") in {x[0] for x in sim.DIFFICULTIES}:
        cfg["difficulty_mine"] = d["difficulty_mine"]
    cfg["pause"] = int(num(d.get("pause"), 0, 3600, cfg["pause"]))
    cfg["max_rounds"] = int(num(d.get("max_rounds"), 0, 1000, cfg["max_rounds"]))
    cfg["per_hour"] = int(num(d.get("per_hour"), 1, 60, cfg["per_hour"]))
    if "on" in d:
        if d["on"] and not cfg["on"]:
            kv(con, "arena_played", 0)
            ST.update(state="A preparar.", error=None)
        cfg["on"], cfg["owner"] = bool(d["on"]), owner
    kv(con, "arena", cfg)


# ---------- rotas e arranque ----------

def route(method, path, owner, body=None):
    """/api/ratings… e /api/arena -> (código, objeto)."""
    import urllib.parse
    u = urllib.parse.urlsplit(path)
    q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
    p, fmt = u.path.rstrip("/"), q.get("format", "").lower()[:40]
    try:
        with ALOCK if p == "/api/arena" else contextlib.nullcontext(), db() as con:
            if p == "/api/arena":
                if method == "POST":
                    arena_set(con, owner, body or {})
                return 200, arena_status(con, owner)
            if p == "/api/ratings":
                fmts = [r[0] for r in con.execute(f"SELECT DISTINCT format FROM ratings WHERE games>0 AND format!='{CASUAL}'"
                                                  f" AND {VISIBLE}", (owner, owner))]
                return 200, {"rows": deck_info(con, table(con, fmt, owner), owner), "formats": fmts, "prov": PROV}
            if p == "/api/ratings/stars":
                return 200, all_stars(con, owner)
            if p == "/api/ratings/reset-all" and method == "POST":  # Definições: recomeçar os ratings de todos os meus decks
                if (body or {}).get("confirm") != "REPOR":
                    return 400, {"erro": "Falta a confirmação."}
                ids = [r[0] for r in con.execute("SELECT id FROM decks WHERE owner=?", (owner,))]
                for i in ids:
                    reset(con, f"deck:{i}")
                return 200, {"decks": len(ids)}
            if p == "/api/ratings/pick":
                src = [s for s in q.get("sources", "meu,meta").split(",") if s in ("meu", "ami", "com", "meta")]
                return 200, pick(con, fmt, owner, int(q.get("n") or 8), float(q.get("min") or 0), float(q.get("max") or TOP), src)
            m = re.fullmatch(r"/api/ratings/deck/((?:deck|meta):[a-z0-9-]{1,130})", urllib.parse.unquote(p))
            if m:
                r = con.execute("SELECT kind, owner FROM ratings WHERE key=? AND format=?", (m.group(1), fmt)).fetchone()
                if not r or r[0] == "meu" and r[1] != owner:
                    return 404, {"erro": "Esse deck não tem rating neste formato."}
                return 200, history(con, m.group(1), fmt)
    except ValueError:
        return 400, {"erro": "pedido inválido"}
    return 404, {"erro": "rota desconhecida"}


def backfill(con):
    """Uma vez (ratings_kv prog_backfill): progresso dos jogos antigos sem a_prog. Torneios: o jogo inteiro de
    tournament_games (exato); Laboratório: o resumo em sim_games (mesmo match_id, pela ordem); Arena: o resumo de
    rating_games.summary (dano e veneno por carta). Os do resumo são aproximados (sem mill nem comandante)."""
    if kv(con, "prog_backfill"):
        return 0
    rows = con.execute("SELECT id, format, a_key, winner, source, round_id, summary FROM rating_games WHERE a_prog IS NULL"
                       " ORDER BY id").fetchall()
    done, by_round, cache = 0, {}, {}
    for r in rows:
        by_round.setdefault(r[5], []).append(r)
    for rid, rs in by_round.items():
        src, fmt, games = rs[0][4], rs[0][1], []
        try:
            if src == "torneio":
                tid, mid = rid.split(":", 1)
                if tid not in cache:
                    st = con.execute("SELECT state FROM tournaments WHERE id=?", (tid,)).fetchone()
                    cache[tid] = json.loads(st[0]) if st else None
                st = cache[tid]
                m = next((m for m in (st or {}).get("matches") or () if m["id"] == mid), None)
                if not m:
                    continue
                a, b = m["p"]
                fmt = st.get("base") or st.get("format") or fmt
                for x in [x for x in m["g"] if not x.get("x")]:
                    blob = con.execute("SELECT game FROM tournament_games WHERE id=? AND tid=?", (x["id"], tid)).fetchone()
                    games.append((json.loads(zlib.decompress(blob[0])), (sim.SIDES[x["s"].index(a)], sim.SIDES[x["s"].index(b)]))
                                 if blob else None)
            elif src == "lab":
                _, did, mid = rid.split(":", 2)
                for w, sm in con.execute("SELECT winner, summary FROM sim_games WHERE deck_id=? AND match_id=? ORDER BY game_no, id", (did, mid)):
                    games.append(({"winner": w, "summary": json.loads(sm or "{}")}, ("a", "b")))
                if rs[0][2] != "deck:" + did:  # o deck do Lab é sempre o lado a do jogo
                    games = [(g, ("b", "a")) for g, _ in games]
            elif src == "arena":
                for r in rs:
                    sm = json.loads(r[6]) if r[6] else None
                    games.append(({"winner": r[3], "summary": {k: sm[k] for k in "ab"}}, ("a", "b")) if sm else None)
        except (ValueError, KeyError, TypeError, sqlite3.OperationalError, zlib.error):
            continue
        for r, x in zip(rs, games):
            pg = x and progs_of(x[0], fmt, x[1])
            if pg:
                con.execute("UPDATE rating_games SET a_prog=?, b_prog=?, prog=? WHERE id=?",
                            (pg[0]["p"], pg[1]["p"], json.dumps({"a": pg[0], "b": pg[1]}), r[0]))
                done += 1
    kv(con, "prog_backfill", done or -1)
    return done


def init(data_dir, busy=None):
    """Arranque do servidor: tabelas e a thread da Arena (retoma sozinha se estava ligada, incluindo a ronda a meio)."""
    global DATA, DB, BUSY
    DATA, DB = data_dir, os.path.join(data_dir, "grimorio.db")
    BUSY = busy or BUSY
    with contextlib.closing(db()) as con, con:
        try:
            n = backfill(con)
            if n:
                print(f"[ratings] progresso calculado em {n} jogos antigos", file=sys.stderr, flush=True)
        except Exception as e:  # um extra: o servidor arranca na mesma
            print(f"[ratings] backfill: {e!r}", file=sys.stderr, flush=True)
    ST["seen"] = time.time()  # dá tempo a quem estava a usar o simulador antes de reiniciar
    threading.Thread(target=arena_loop, daemon=True).start()


# ---------- verificação ----------

def selfcheck():
    con = schema(sqlite3.connect(":memory:"))
    con.execute("CREATE TABLE decks (id TEXT PRIMARY KEY, name TEXT, format TEXT, body TEXT, updated REAL, owner TEXT, deleted REAL)")
    D = lambda k, kind="meta", owner="": {"key": k, "kind": kind, "name": k, "owner": owner}  # noqa: E731
    # Elo: iguais -> ±20 (K provisório 40); a soma conserva-se enquanto os K são iguais
    record_round(con, "pauper", D("meta:x"), D("meta:y"), ["a"], "lab")
    ex, ey = (con.execute("SELECT elo FROM ratings WHERE key=?", (k,)).fetchone()[0] for k in ("meta:x", "meta:y"))
    assert abs(ex - 1520) < 1e-9 and abs(ey - 1480) < 1e-9, (ex, ey)
    assert abs(expected(1600, 1400) - 0.7597) < 1e-3 and abs(expected(1500, 1500) - 0.5) < 1e-12
    # Bo3 dividido em chamadas: a ronda só conta no fim, com os jogos todos (2–1 para y)
    rid = record_round(con, "pauper", D("meta:x"), D("meta:y"), ["b"], "torneio", "r1", final=False)
    record_round(con, "pauper", D("meta:y"), D("meta:x"), ["b"], "torneio", "r1", final=False)  # lados trocados: x ganha
    assert con.execute("SELECT SUM(rounds) FROM ratings").fetchone()[0] == 2  # só a ronda Bo1 do início
    record_round(con, "pauper", D("meta:x"), D("meta:y"), ["b"], "torneio", rid)
    x = dict(zip(COLS, con.execute(f"SELECT {', '.join(COLS)} FROM ratings WHERE key='meta:x'").fetchone()))
    assert (x["games"], x["wins"], x["losses"], x["rounds"], x["round_wins"], x["round_losses"]) == (4, 2, 2, 2, 1, 1), x
    # Lab: Bo3 pelo match_id; 2–0 fecha a série
    con.execute("INSERT INTO decks VALUES ('d1', 'Meu', 'pauper', '{}', 0, 'ana', NULL)")
    for w in ("a", "a"):
        from_lab(con, {"deck_id": "d1", "opp_key": "meta:pauper-1", "opp_name": "Affinity", "format": "pauper", "match_id": "m1",
                       "winner": w, "bo": 3}, "ana")
    from_lab(con, {"deck_id": "d1", "opp_key": "meta:pauper-1", "format": "pauper", "winner": "a"}, "outro")  # não é dele
    r = con.execute("SELECT games, wins, rounds, round_wins, owner FROM ratings WHERE key='deck:d1'").fetchone()
    assert r == (2, 2, 1, 1, "ana"), r
    # estrelas = 6 × P(ganhar a um deck médio): 3★ a meio, 6★ só a ganhar quase sempre
    assert stars(1500) == 3 and stars(1662) == 4.3 and stars(1800) == 5.1 and stars(1200) == 0.9
    assert stars(2400) == 6 and stars(2000) < 6 and stars(600) == 0 and stars(2110) == 6 and stars(2090) == 5.8
    # tabela: escalões e ranking dentro do escalão; o deck apagado some; provisórios marcados
    rng = random.Random(3)
    for i in range(12):
        for _ in range(12):
            j = rng.randrange(12)
            if j != i:
                record_round(con, "modern", D(f"meta:m{i}"), D(f"meta:m{j}"), ["a" if rng.random() < (i + 1) / 13 else "b"], "arena")
    con.execute("INSERT INTO decks VALUES ('d2', 'Apagado', 'modern', '{}', 0, 'ana', 1)")
    record_round(con, "modern", D("deck:d2", "meu", "ana"), D("meta:m0"), ["a"], "lab")
    t = table(con, "modern", "ana")
    assert len(t) == 12 and [r["rank"] for r in t] == list(range(1, 13)) and all(r["elo"] >= s["elo"] for r, s in zip(t, t[1:]))
    for tier in {r["tier"] for r in t}:
        assert [r["rank_in_tier"] for r in t if r["tier"] == tier] == list(range(1, 1 + sum(r["tier"] == tier for r in t)))
    assert t[0]["stars"] > t[-1]["stars"] and t[0]["stars"] == stars(t[0]["elo"]) and not any(r["provisional"] for r in t)
    assert table(con, "pauper", "ana")[0]["provisional"]
    # escolher por estrelas: sem rating = 3,0★; os meus e os do meta
    sim.opponents = lambda d, f, top=12: [{"id": f"modern-{i}", "name": f"Meta {i}"} for i in range(3)]
    con.execute("INSERT INTO decks VALUES ('d3', 'Novo', 'modern', '{}', 0, 'ana', NULL)")
    assert {x["key"] for x in pick(con, "modern", "ana", 10, 3, 3)} == {"deck:d3", "meta:modern-0", "meta:modern-1", "meta:modern-2"}
    assert not pick(con, "modern", "ana", 10, 3.5, 6) and len(pick(con, "modern", "ana", 2, 0, 6, ("meu",))) == 1
    assert pick(con, "modern", "outro", 10, 0, 5, ("meu",)) == []
    # Arena: o par fica no intervalo e prefere o mesmo escalão
    for i in range(12):
        con.execute("UPDATE ratings SET key=? WHERE key=?", (f"meta:modern-{i}", f"meta:m{i}"))
    sim.opponents = lambda d, f, top=12: [{"id": f"modern-{i}", "name": f"Meta {i}"} for i in range(12)]
    cfg = {**ARENA, "owner": "ana", "formats": ["modern"], "min": 1.0, "max": 5.0}
    same = 0
    for _ in range(200):
        p = pairing(con, cfg, rng)
        assert 1 <= p["a"]["stars"] <= 5 and 1 <= p["b"]["stars"] <= 5 and p["a"]["key"] != p["b"]["key"]
        same += int(p["a"]["stars"]) == int(p["b"]["stars"])
    assert same > 120, same
    h = history(con, "deck:d1", "pauper")
    assert h["elo"][0] == START and len(h["elo"]) == 3 and h["rounds"][0]["w"] == 2 and h["rounds"][0]["opp_name"] == "Affinity"
    # casual: o modo casual e os decks casuais vão para o rating casual; o normal não lhes mexe
    con.execute("""INSERT INTO decks VALUES ('d4', 'Proibido', 'modern', '{"casual": true}', 0, 'ana', NULL)""")
    before = con.execute("SELECT elo, games FROM ratings WHERE key='meta:modern-0' AND format='modern'").fetchone()
    record_round(con, "modern", D("deck:d4", "meu", "ana"), D("meta:modern-0"), ["a"], "torneio")  # deck casual
    from_lab(con, {"deck_id": "d1", "opp_key": "meta:modern-0", "format": "pauper", "winner": "a", "casual": True}, "ana")
    record_round(con, "modern", D("meta:modern-1"), D("meta:modern-0"), ["b"], "torneio", casual=True)
    assert con.execute("SELECT elo, games FROM ratings WHERE key='meta:modern-0' AND format='modern'").fetchone() == before
    assert not con.execute("SELECT 1 FROM ratings WHERE key='deck:d4' AND format!=?", (CASUAL,)).fetchone()
    assert con.execute("SELECT games FROM ratings WHERE key='meta:modern-0' AND format=?", (CASUAL,)).fetchone() == (3,)
    assert [r["key"] for r in table(con, CASUAL, "ana")][:1] and all(r["format"] == CASUAL for r in table(con, CASUAL, "ana"))
    st = all_stars(con, "ana")
    assert "deck:d4" not in st and "deck:d4|casual" in st and "deck:d1|casual" in st and st["deck:d1"]["format"] == "pauper"
    t = table(con, "all", "ana")
    assert {r["format"] for r in t} == {"pauper", "modern"} and [(-r["stars"], -r["elo"]) for r in t] == sorted((-r["stars"], -r["elo"]) for r in t)
    assert "deck:d4" not in {x["key"] for x in candidates(con, "modern", "ana")}
    assert {"deck:d1", "deck:d3", "deck:d4"} <= {x["key"] for x in candidates(con, CASUAL, "ana")}
    p = pairing(con, {**cfg, "casual": True, "min": 0, "max": TOP}, rng)
    assert p["format"] == CASUAL and p["base"] == "modern"
    # registo do deck: Lab + Arena (com resumo), sem contar duas vezes os jogos do Lab que também estão em rating_games
    con.execute("CREATE TABLE sim_games (id INTEGER PRIMARY KEY, ts REAL, deck_id TEXT, deck_name TEXT, format TEXT, opp_name TEXT,"
                " opp_archetype TEXT, game_no INTEGER, match_id TEXT, winner TEXT, turns INTEGER, a_side_in TEXT, a_side_out TEXT, summary TEXT)")
    sm = lambda a, b: json.dumps({"a": {"damage_by_card": a}, "b": {"damage_by_card": b}})  # noqa: E731
    con.execute("INSERT INTO sim_games (deck_id, opp_name, winner, summary) VALUES ('d1', 'Affinity', 'a', ?)", (sm({"Bolt": 6, "Guide": 14}, {"Ornithopter": 3}),))
    con.execute("INSERT INTO sim_games (deck_id, opp_name, winner, summary) VALUES ('d1', 'Affinity', 'b', ?)", (sm({"Bolt": 3}, {"Ornithopter": 20}),))
    record_round(con, "pauper", {**D("meta:pauper-1"), "name": "Affinity"}, D("deck:d1", "meu", "ana"), ["b"], "arena", "ar1")
    con.execute("UPDATE rating_games SET summary=? WHERE round_id='ar1'", (sm({"Elf": 2}, {"Bolt": 20}),))
    r = deck_record(con, "d1", "ana")
    aff = next(o for o in r["opponents"] if o["name"] == "Affinity")
    assert (r["games"], aff["w"], aff["l"], r["by_source"]) == (3, 2, 1, {"lab": 2, "arena": 1}), r
    assert r["dealt"] == round((20 + 3 + 20) / 3, 1) and r["taken"] == round((3 + 20 + 2) / 3, 1)
    assert r["by_source_wld"] == {"lab": {"w": 1, "l": 1, "d": 0}, "arena": {"w": 1, "l": 0, "d": 0}}, r["by_source_wld"]
    assert r["cards"][0] == {"card": "Bolt", "dmg": 29, "games": 3, "top_wins": 1} and deck_record(con, "d1", "outro") is None
    # progresso rumo à vitória: o «ou» das vias, com dano a mais (overkill) e o teto
    dmg = lambda p, t, n, **k: {"k": "damage", "p": p, "target": t, "n": n, **k}  # noqa: E731
    g = {"winner": "a", "reason": "Ai(2)-B has lost because life total reached 0", "events": [dmg("a", "b", 26), dmg("b", "a", 5)],
         "summary": {"a": {}, "b": {}, "life": [[15, -10]]}}
    pa, pb = progress(g, "a", "modern"), progress(g, "b", "modern")
    assert pa["dmg"] == 1.5 and pa["p"] == 1.5 and pa["by"] == "dmg" and pb["p"] == 0.25 and pb["by"] == "dmg", (pa, pb)
    g["summary"]["life"] = [[15, -60]]
    assert progress(g, "a")["p"] == CAP
    g = {"winner": "a", "reason": "B has lost trying to draw cards from empty library", "setup": {"a": {"size": 60}, "b": {"size": 60}},
         "events": [{"k": "mill", "p": "b", "n": 40}, {"k": "exile", "p": "b", "target": "library>exile", "id": 9}, dmg("a", "b", 4)],
         "summary": {"a": {}, "b": {}}}
    pa = progress(g, "a")
    assert pa["mill"] == 1 and pa["by"] == "mill" and pa["p"] == 1 and abs(progress({**g, "winner": "b"}, "a")["mill"] - 41 / 53) < 1e-3
    g = {"winner": "b", "reason": "A has lost because of obtaining 10 poison counters", "summary": {"a": {}, "b": {}},
         "events": [{"k": "poison", "p": "b", "target": "a", "n": 7}, dmg("b", "a", 3, psn=1), dmg("a", "b", 10)]}
    assert progress(g, "b")["psn"] == 1 and progress(g, "b")["p"] == 1 and progress(g, "a")["p"] == 0.5
    assert progress({**g, "winner": "draw"}, "b")["p"] == 1.0  # 10 de veneno no total, mesmo sem a razão
    g = {"winner": "a", "reason": "B has lost due to accumulation of 21 damage from generals", "setup": {"a": {"commanders": ["Uril"]}, "b": {}},
         "events": [dmg("a", "b", 14, card="Uril", combat=1), dmg("a", "b", 5, card="Bolt")], "summary": {"a": {}, "b": {}}}
    pa = progress(g, "a", "commander")
    assert pa["cmd"] == 1 and abs(pa["dmg"] - 19 / 40) < 1e-3 and pa["by"] == "cmd"
    g = {"winner": "a", "reason": "B has lost due to effect of spell 'Thassa's Oracle'", "summary": {"a": {}, "b": {}}, "events": [dmg("a", "b", 2)]}
    assert progress(g, "a")["alt"] == 1 and progress(g, "a")["by"] == "alt"
    # sem events (resumo antigo): dano por carta
    assert progress({"winner": "b", "summary": {"a": {"damage_by_card": {"Bolt": 6, "Guide": 4}}, "b": {}}}, "a")["p"] == 0.5
    # 4 jogadores: média por adversário; quem eliminou um tem ≥ 1 nesse; o vencedor ≥ 1
    g = {"winner": "a", "summary": {s: {} for s in "abcd"}, "out": {"b": {"by": "a", "why": "has lost because life total reached 0"},
         "c": {"by": "d", "why": "has lost because life total reached 0"}},
         "events": [dmg("a", "b", 20), dmg("a", "c", 10), dmg("a", "d", 0), dmg("d", "c", 10)]}
    assert abs(progress(g, "a")["p"] - 1.0) < 1e-9 and progress(g, "a")["dmg"] == 0.5
    assert progress(g, "d")["p"] == round((1 + 0) / 3, 3), progress(g, "d")
    # camadas: azul = Elo de todos os jogos (sem casuais igual ao amarelo); vermelho = média do progresso em estrelas
    c2 = schema(sqlite3.connect(":memory:"))
    c2.execute("CREATE TABLE decks (id TEXT PRIMARY KEY, name TEXT, format TEXT, body TEXT, updated REAL, owner TEXT, deleted REAL)")
    win = {"winner": "a", "reason": "life", "events": [dmg("a", "b", 24)], "summary": {"a": {}, "b": {}}}
    for _ in range(3):
        record_round(c2, "pauper", D("meta:p"), D("meta:q"), ["a"], "arena", progs=[progs_of(win, "pauper")])
    ly = layers(c2)
    assert ly["meta:p"]["blue_elo"] == round(c2.execute("SELECT elo FROM ratings WHERE key='meta:p'").fetchone()[0])
    assert ly["meta:p"]["blue"] == stars(c2.execute("SELECT elo FROM ratings WHERE key='meta:p'").fetchone()[0], [])
    assert ly["meta:p"]["red"] == 3.6 and ly["meta:p"]["goal"] == 1.2 and ly["meta:q"]["red"] == 0 and ly["meta:p"]["by"] == {"dmg": 3}
    record_round(c2, "pauper", D("meta:p"), D("meta:q"), ["b"] * 3, "arena", casual=True)  # casual: só o azul se mexe
    ly2 = layers(c2)
    assert ly2["meta:p"]["blue_elo"] < ly["meta:p"]["blue_elo"] and ly2["meta:p"]["red_games"] == 3 and ly2["meta:p"]["blue_games"] == 6
    assert goal_stars(0.5) == 1.5 and goal_stars(1) == 3 and goal_stars(1.5) == 4.5 and goal_stars(2) == 6 and goal_stars(3) == 6 and goal_stars(0) == 0
    st = all_stars(c2, "")
    assert st["meta:p"]["red"] == 3.6 and st["meta:p|casual"]["blue"] == st["meta:p"]["blue"]
    # recuperar o progresso dos jogos antigos: Arena pelo resumo guardado
    c2.execute("UPDATE rating_games SET a_prog=NULL, b_prog=NULL, prog=NULL")
    c2.execute("""UPDATE rating_games SET summary='{"a": {"damage_by_card": {"X": 10}}, "b": {}}' WHERE format='pauper'""")
    assert backfill(c2) == 3 and backfill(c2) == 0 and layers(c2)["meta:p"]["goal"] == 1.0
    # recomeço (lista mudou >10%): o deck perde amarelo, azul e vermelho; o adversário guarda os seus jogos
    reset(c2, "meta:p")
    ly3 = layers(c2)
    assert "meta:p" not in ly3 and "meta:p@antes" in ly3 and ly3["meta:q"]["blue_games"] == 6
    assert not rated(c2, "meta:p") and "meta:p" not in all_stars(c2, "") and history(c2, "meta:p", "pauper")["rounds"] == []
    record_round(c2, "pauper", D("meta:p"), D("meta:q"), ["a"], "arena")
    assert layers(c2)["meta:p"]["blue_games"] == 1 and rated(c2, "meta:p")
    # bot dos meus decks na Arena (Definições › Bots predefinidos): só perfis conhecidos ou vazio
    c2 = sqlite3.connect(":memory:")
    schema(c2)
    arena_set(c2, "ana", {"difficulty_mine": "zzz"})
    assert settings(c2)["difficulty_mine"] == ""
    arena_set(c2, "ana", {"difficulty_mine": sim.DIFFICULTIES[1][0]})
    assert settings(c2)["difficulty_mine"] == sim.DIFFICULTIES[1][0]
    print("selfcheck ok")


if __name__ == "__main__":
    selfcheck()
