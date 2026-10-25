"""Grimório — laboratório de testes: jogos reais com o motor do Forge (Java, em Docker ou local: RUNTIME).

Um trabalho = uma invocação do Forge (`sim -n jogos`), um de cada vez numa thread
(a máquina tem pouca RAM: contentor com -m 3g e -Xmx2g). O registo do Forge é
convertido em eventos compactos + resumo por jogo.

O que o Forge regista (modo sim, en-US): Turn, Mulligan ("kept a hand of N",
"mulliganed down to N"), Land, Add To Stack (cast/triggered/activated, com alvos),
Resolve Stack (texto da resolução; "ability fizzles"), Combat (atacantes, bloqueios),
Damage (fonte -> alvo, combate ou não), Life (antes > depois), Zone Change (raro),
Discard, Replacement Effect, Game Outcome. NÃO regista compras, a mão, nem mortes
de criaturas de forma fiável; os ids "(26)" identificam cada carta durante o jogo.

Com o nosso lançador (build/forge/GrimorioSim.java) o registo chega ao vivo e vem intercalado com linhas
"GRIMORIO|…" tiradas do bus de eventos do Forge: mudanças de zona exatas (compras com o nome da carta, mortes,
fichas, moer, procurar…), a mão no início de cada turno, viradas, marcadores e anexos. O jogo fica `exact`.
"""
import json, os, re, shutil, subprocess, sys, threading, time, unicodedata, urllib.request, uuid, zipfile

FORGE_JAR = "forge-gui-desktop-2.0.15-jar-with-dependencies.jar"
IMAGE = "eclipse-temurin:17-jre"
UA = {"User-Agent": "Grimorio/1.0 (uso pessoal)"}
TIMEOUT_PAD = 90  # s além de clock*jogos: arranque da JVM + leitura das cartas ~15 s
# id -> perfil do Forge (res/ai/*.ai); cada lado escolhe o seu (difficulty_a / difficulty). Com o nosso lançador os
# perfis são as cópias de forge-ext/ai (build/forge/build.sh): nenhuma chance fica em 0% ou 100%, passa a 10%/90%.
DIFFICULTIES = [
    ("default", "Default", "Normal", "A IA padrão do Forge, equilibrada (chances de 0%/100% suavizadas para 10%/90%)."),
    ("cautious", "Cautious", "Cautelosa", "Defensiva: troca criaturas e contraria menos, guarda truques de combate."),
    ("reckless", "Reckless", "Imprudente", "Agressiva: ataca para trocar quase sempre (≈90%), mesmo exposta; contraria muito."),
    ("experimental", "Experimental", "Experimental", "A padrão com heurísticas novas do Forge (mais ousada, menos testada)."),
    ("random", "Random (Every Game)", "Aleatória", "Um perfil ao acaso em cada jogo."),
    ("forte", "Default", "Forte (verifica jogadas)", "A Normal, mas simula cada jogada antes de a fazer e põe de lado "
     "as que deixam o jogo pior (IA híbrida do Forge)."),
]
# dificuldade -> modo de pesquisa do GrimorioSim (-S), por jogador. «hybrid» e não «full»: a pesquisa completa do Forge
# avalia só mão, vida, mana e campo (cemitério vale 0: Unmarked Grave nunca saía), copia o jogo sem a pilha (não
# contraria nada; Force of Negation pelo custo alternativo falha ao pagar) e esgota os 2 GB de memória a meio da série.
SEARCH = {"forte": "hybrid"}
SEARCH_CLOCK = 3  # margem para o relógio do Forge (até 900 s); a híbrida mede-se ao nível da Normal
# formato da app -> tipo de jogo do Forge (-f); o resto joga-se como Constructed
GAME_TYPE = {"commander": "Commander", "duel": "Commander", "paupercommander": "Commander", "predh": "Commander",
             "oathbreaker": "Oathbreaker", "brawl": "Brawl", "standardbrawl": "Brawl"}
SIDES = "abcd"  # lugar 1..4 no Forge -> lado; "a" é sempre o teu deck
# modo -> (jogadores, equipas por lugar). O Forge 2.0.15 não tem Two-Headed Giant (vida e turno partilhados): «2hg» joga-se
# como «equipas», 2 contra 2 com vidas e turnos separados, parceiros em lugares alternados (a+c contra b+d).
MODES = {"1v1": (2, None), "ffa3": (3, None), "ffa4": (4, None), "equipas": (4, [1, 2, 1, 2]), "2hg": (4, [1, 2, 1, 2])}
META_FORMATS = ("standard", "pioneer", "modern", "legacy", "vintage", "pauper", "premodern")
EDH_FORMATS = ("commander", "duel")
# modo casual (formatos misturados): as regras base (formato escolhido) dão o tipo de jogo e a vida de todos; cada deck
# com comandante leva-o à mesma (zona de comando, imposto, 21 de dano de comandante) — GrimorioSim -C/-L
BASE_LIFE = {"commander": 40, "predh": 40, "paupercommander": 30, "brawl": 25, "standardbrawl": 25}


def art_map(deck):
    """Artes de um deck para o tabuleiro: {carta: id da edição escolhida | imagem própria | [{"id", "q"}] (cópias divididas
    por várias artes, ex.: 4 Islands de uma edição e 4 de outra)}. A imagem própria ganha à edição; a divisão ganha a tudo."""
    if not isinstance(deck, dict):
        return {}
    out = {n: p["id"] for n, p in (deck.get("prints") or {}).items() if isinstance(p, dict) and p.get("id")}
    out.update({n: u for n, u in (deck.get("art") or {}).items() if isinstance(u, str) and u})
    out.update({n: l for n, l in (deck.get("split") or {}).items() if isinstance(l, list) and l})
    return out


def base_life(fmt, n):
    """Vida inicial das regras base de um formato (Brawl a 3+ jogadores: 30)."""
    return 30 if fmt in ("brawl", "standardbrawl") and n > 2 else BASE_LIFE.get(fmt, 20)


# prefixo dos contentores: o arranque do trabalhador mata as sobras com este prefixo; um servidor de testes usa outro
# (GRIMORIO_SIM_PREFIX) para não matar os jogos do servidor a sério
PREFIX = os.environ.get("GRIMORIO_SIM_PREFIX", "grimorio-sim-")

# Onde corre o Forge: «docker» (servidor Linux: contentor eclipse-temurin com -m 3g, os forge-ext/ai e cardsfolder
# montados por cima do res do Forge) ou «local» (Java 17 do sistema ou o JRE dos pacotes, GRIMORIO_JAVA; sem Docker).
# Em «local» o Forge tem de trazer os forge-ext/ai e cardsfolder já copiados para o res (os pacotes fazem-no:
# packaging/build.py). Por omissão: docker se houver docker e não for Windows, senão local.
RUNTIME = os.environ.get("GRIMORIO_RUNTIME", "").lower() or \
    ("docker" if os.name != "nt" and shutil.which("docker") and not os.environ.get("GRIMORIO_JAVA") else "local")
JAVA = os.environ.get("GRIMORIO_JAVA") or shutil.which("java") or "java"
PROCS = {}  # jid -> Popen do java (runtime local), para cancelar


def forge_dir(data_dir):
    """Pasta do Forge: GRIMORIO_FORGE_DIR (os pacotes trazem-no ao lado da app) ou <data>/forge."""
    return os.environ.get("GRIMORIO_FORGE_DIR") or os.path.join(data_dir, "forge")

# ---------- nomes de cartas: Scryfall -> Forge ----------

_names = None


def fold(n):
    n = unicodedata.normalize("NFKD", n).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]", "", n)  # "Fire // Ice" == "Fire/Ice"


def forge_names(forge_dir, cache_dir):
    """{nome dobrado: nome no Forge}. Cartas divididas (Split/Room) chamam-se "A // B";
    as de duas faces, aventuras, flip, etc. só pela face da frente. Cache pela mtime do zip."""
    global _names
    if _names is not None:
        return _names
    zpath = os.path.join(forge_dir, "res", "cardsfolder", "cardsfolder.zip")
    cache = os.path.join(cache_dir, "forge-names.json")
    stamp = int(os.path.getmtime(zpath))
    try:
        with open(cache) as f:
            c = json.load(f)
        if c["stamp"] == stamp:
            _names = c["names"]
            return _names
    except (OSError, ValueError, KeyError):
        pass
    names = {}
    with zipfile.ZipFile(zpath) as z:
        for fn in z.namelist():
            if fn.endswith("/"):
                continue
            s = z.read(fn).decode("utf-8", "replace")
            ns = re.findall(r"^Name:(.+?)\s*$", s, re.M)
            if not ns:
                continue
            names.setdefault(fold(ns[0]), ns[0])
            if re.search(r"^AlternateMode:Split", s, re.M) and len(ns) > 1:
                names[fold(ns[0] + " // " + ns[1])] = ns[0] + " // " + ns[1]
    os.makedirs(cache_dir, exist_ok=True)
    with open(cache + ".tmp", "w") as f:
        json.dump({"stamp": stamp, "names": names}, f)
    os.replace(cache + ".tmp", cache)
    _names = names
    return names


def to_forge(name, names):
    """Nome da app (Oracle da Scryfall) -> nome do Forge, ou None se o Forge não a tem."""
    return names.get(fold(name)) or names.get(fold(name.split(" // ")[0]))


def to_dck(deck, label, game_type, names):
    """deck {commanders, signature?, main, side} -> (texto .dck, [cartas desconhecidas])."""
    unknown, out = [], {"Commander": [], "Main": [], "Sideboard": []}
    cmd = list(deck.get("commanders") or []) + ([deck["signature"]] if deck.get("signature") else [])
    rows = [("Commander", n, 1) for n in cmd] if game_type != "Constructed" else []
    rows += [("Main", n, q) for n, q in (deck.get("main") or {}).items()]
    rows += [("Sideboard", n, q) for n, q in (deck.get("side") or {}).items()]
    for sec, n, q in rows:
        f = to_forge(n, names)
        if f is None:
            unknown.append(n)
        elif int(q) > 0:
            out[sec].append(f"{int(q)} {f}")
    txt = f"[metadata]\nName={label}\n"
    for sec in ("Commander", "Main", "Sideboard"):
        if out[sec]:
            txt += f"[{sec}]\n" + "\n".join(out[sec]) + "\n"
    return txt, unknown


# ---------- leitura do registo do Forge ----------

ID = re.compile(r" \((\d+)\)$")  # só no fim: "Goblin Guide (10)"
ITEMS = re.compile(r"(.+?) \((\d+)\)(?:, | and |$)")
REF = re.compile(r"([A-Z][^()\[\]]*?) \((\d+)\)")  # "Elvish Mystic (67)" dentro de um texto
NOISE = re.compile(r"^\s*at |Exception|^\s*\.\.\. \d+ more|^Caused by|Did not have activator set")
PHASE = {"Untap step": "untap", "Upkeep step": "upkeep", "Draw step": "draw", "Main phase, precombat": "main1",
         "Main phase, postcombat": "main2", "End step": "end", "Cleanup step": "end"}  # o resto são passos de combate
NUM = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
       "nine": 9, "ten": 10}
NUMS = r"(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)"
TOKEN = re.compile(r"(?i:\bcreates?) (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|X|that many) "
                   r"(?:tapped )?(?:(\d+|X)/(\d+|X) )?(?:(?:white|blue|black|red|green|colorless|and|,) ?)*"
                   r"((?:[A-Z][\w'-]*,? )*)(?:(?:legendary|snow|artifact|enchantment|land|creature) )*tokens?"
                   r"(?: with ([a-z ,]+))?")
COUNTERS = re.compile(r"(?i:\b(put|remove)s?) " + NUMS + r" ([+-]\d+/[+-]\d+|[a-z]+) counters? (?:on|from) "
                      r"(this creature|it|each [^.]*|(?:[A-Z][^.()\[]*?)(?: \(\d+\))?)(?=\.| and |$| at | for | \[)")


def split_games(out):
    """Saída completa do Forge -> [(linhas do jogo, linha 'Game Result')]; o cabeçalho
    "Ai(1)-X vs Ai(2)-Y - ..." (só aparece uma vez) vai à frente de cada jogo."""
    head = re.search(r"^Ai\(1\)-.* vs Ai\(2\)-.*$", out, re.M)
    games, cur = [], [head.group(0)] if head else []
    for line in out.splitlines():
        if line.startswith("Game Result:"):
            games.append((cur, line))
            cur = [head.group(0)] if head else []
        else:
            cur.append(line)
    return games


def num(w):
    return NUM.get(w.lower()) if not w.isdigit() else int(w)


def parse_game(lines, result, decks=None, commanders=None):
    """Linhas de um jogo -> {winner, turns, ms, reason, events, summary}.
    decks: {"a": [nomes], "b": [nomes]} para devolver os nomes da app (faces -> "A // B");
    commanders: {"a": [nomes], ...} (o comandante lançado da zona de comando não sai da mão).

    Cada evento é {t, k, p?, card?, target?, n?, txt} + campos opcionais: id/tid (id da carta/do alvo
    durante o jogo, o que o Forge mostra entre parênteses), ph, pt, ct, kw, to, bk, combat, dt, gone, all, reveal,
    ctr ({"loyalty": 4}: marcadores com que a carta entra, da linha "enters with N … counters").
    Tipos que o Forge regista diretamente:
      turn (reveal: cartas que cada lado vai jogar da mão neste turno — prova de que estavam na mão),
      phase (ph: untap/upkeep/draw/main1/combat/main2/end; só quando a fase tem acontecimentos),
      mulligan, land (tapped: entrou virado, pela linha "enters tapped."), cast, trigger, activate,
      resolve (pt "2/1" nas criaturas), counter (feitiço que anula), countered (to: zona do anulado),
      attack, block (card = bloqueador, target = atacante), damage (combat: 1 no passo de combate; dt: toque
      mortal; gone: 1 se o alvo nunca mais aparece em jogo depois — provável morte), poison, life,
      destroy/exile/bounce/other (mudanças de zona a partir do campo de batalha; target "frm>to"), discard,
      tap (linhas "Mana:" com {T}: o terreno/permanente que deu mana), outcome.
    Tipos tirados do texto das resoluções (ingl. do Forge ou do oráculo):
      token (card "Goblin Token", n, pt, kw), counters (ct "+1/+1"/"loyalty"/…, n com sinal), pump (pt "+4/+4"
      até ao fim do turno; all: 1 = "creatures you control"), attach (equipamento/aura -> tid), untap/tap por
      efeito, transform (to: nome da face nova; a mudança de nome do mesmo id), draw (n), search (to), mill (n,
      inclui vigiar para o cemitério), player (to: monarch/initiative/emblem/energy), goad.
    O Forge NÃO regista compras normais, a mão, desvirar, mortes por dano letal, nem contadores postos por
    linhas de substituição sem nome; isso é inferido no modelo do tabuleiro (web/src/game.js).

    Jogos com linhas GRIMORIO (o nosso lançador) são exatos (`exact: True`): as mudanças de zona do Forge entram
    como `zn` [{id, card, from, to, fp, tp, tok?, pt?, kw?, ctr?, att?}] (fp/tp: de quem é a zona de partida/chegada)
    no evento do registo que as explica (land, cast, resolve, counter, discard) ou num evento próprio com x: 1 —
    draw (com o nome da carta), mill, token, discard, destroy/exile/bounce/other (target "frm>to") ou zone;
    hd {a: [nomes]} / lib {a: n} = a mão e a biblioteca depois do evento; turn.ut = ids desvirados no passo de
    desvirar; tap/untap/counters (abs = valor final)/attach com x: 1 vêm diretamente do Forge. Nesse caso as
    inferências (gone, reveal, fichas/contadores/compras tirados do texto) não são feitas."""
    head = next((l for l in lines if re.match(r"^Ai\(1\)-.* vs Ai\(2\)-", l)), "")
    # "Ai(1)-A [Default] vs Ai(2)-B [Default] vs Ai(3)-C … - one game of …": lugares 1..4 -> lados a..d
    ns = re.findall(r"(Ai\(\d\)-.+?)(?: \[[^\]]*\])?(?= vs Ai\(\d\)-| - )", head)
    pnames = {n: SIDES[j] for j, n in enumerate(ns[:4])} if len(ns) >= 2 else {"Ai(1)-A": "a", "Ai(2)-B": "b"}
    preg = re.compile("|".join(re.escape(p) for p in sorted(pnames, key=len, reverse=True)))
    face = {}  # face -> nome da app; carta -> lados que a têm
    owner_by_name = {}
    for side, ns in (decks or {}).items():
        for full in ns:
            for f in [full] + full.split(" // "):
                face.setdefault(f, full)
            owner_by_name.setdefault(full, set()).add(side)
    cmd = {s: set(v) for s, v in (commanders or {}).items()}
    canon = lambda n: face.get(n, n) if n else n
    id_name, id_face, id_side, last_caster, start_life = {}, {}, {}, {}, {}
    pre = []  # eventos descobertos a meio de uma linha (transformações) que vão antes dela
    pst = []  # pilha do Forge: [{k, p, card}] para saber de quem é cada resolução

    def side_of(s):
        mm = preg.search(s or "")
        return pnames[mm.group(0)] if mm else None

    def is_back(i):
        full = canon(id_name.get(i))
        return bool(full and " // " in full and id_face.get(i) == full.split(" // ")[1])

    def card(s):
        """'Goblin Guide (10)' -> nome canónico (pelo id, que não muda ao transformar)."""
        s = s.strip()
        mm = ID.search(s)
        if mm:
            i, raw = mm.group(1), s[:mm.start()]
            id_name.setdefault(i, raw)
            if id_face.get(i, raw) != raw:  # o mesmo objeto com outro nome: transformou-se / virou-se
                pre.append({"k": "transform", "p": id_side.get(i), "card": canon(id_name[i]), "id": int(i), "to": raw})
            id_face[i] = raw
            return canon(id_name[i])
        return canon(s) or None

    def cid(s):
        mm = ID.search((s or "").strip())
        return int(mm.group(1)) if mm else None

    def target(s):
        p = side_of(s)
        return p if p and preg.fullmatch(s.strip().rstrip(".")) else card(s.strip().rstrip("."))

    def owner(src_raw, name):
        mm = ID.search(src_raw)
        if mm and mm.group(1) in id_side:
            return id_side[mm.group(1)]
        if name in last_caster:
            return last_caster[name]
        sides = owner_by_name.get(name, ())
        return next(iter(sides)) if len(sides) == 1 else None

    ev, t, active, turns, ms = [], 0, None, None, None
    reason, winner = None, "draw"
    ph, ph_txt, shown_ph, tapped_next, mana_wait, ctr_next = None, "", None, set(), [], {}
    exact = any(l.startswith("GRIMORIO|") for l in lines)
    hands, lib, dirty = {x: [] for x in pnames.values()}, {}, set()  # mão exata [(id, nome)], biblioteca, lados mudados
    bf, wait, pz, turn_ev = set(), {}, [], None  # ids no campo; marcadores/anexo antes de entrar; zonas por explicar
    out = {}  # 3+ jogadores: lado eliminado -> {t, by (quem lhe tirou a última vida), why}, pela ordem de eliminação
    pname = {v: k for k, v in pnames.items()}

    def absorbs(x, z):
        """O evento do registo `x` é a mesma jogada que a mudança de zona `z`?"""
        if not (x.get("id") == z["id"] or (x.get("card") and x["card"] == z["card"])):
            return False
        return {"land": z["from"] == "hand" and z["to"] == "battlefield", "cast": z["to"] == "stack",
                "resolve": z["from"] == "stack", "counter": z["from"] == "stack",
                "discard": z["from"] == "hand" and z["to"] == "graveyard"}.get(x["k"], False)

    def zone_event(z):
        fz, tz = z["from"], z["to"]
        k = "draw" if (fz, tz) == ("library", "hand") else "mill" if (fz, tz) == ("library", "graveyard") else \
            "token" if fz is None and z.get("tok") else "discard" if (fz, tz) == ("hand", "graveyard") else \
            {"graveyard": "destroy", "exile": "exile", "hand": "bounce"}.get(tz, "other") if fz == "battlefield" else \
            "exile" if tz == "exile" else "zone"
        e = {"k": k, "p": z["tp"] if k in ("draw", "token", "zone") or fz is None else z["fp"], "card": z["card"],
             "id": z["id"], "x": 1, "zn": [z]}
        if k in ("draw", "mill", "token"):
            e["n"] = 1
        if k == "token":
            e["pt"], e["kw"] = z.get("pt"), z.get("kw")
        if k in ("destroy", "exile", "bounce", "other", "zone"):
            e["target"] = f"{fz or 'none'}>{tz}"
        return e

    def emit(e, s):
        nonlocal shown_ph
        if e["k"] != "turn" and ph and ph != shown_ph and t:
            shown_ph = ph
            ev.append({"t": t, "k": "phase", "p": active, "ph": ph, "txt": ph_txt[:300]})
        nonlocal turn_ev
        for x in pre + [e]:
            for nm in (x.get("card"), x.get("to")):
                if nm in ctr_next and x["k"] in ("resolve", "transform", "land"):
                    x["ctr"] = ctr_next.pop(nm)
            i = x.get("id")
            if i is not None and is_back(str(i)) and x["k"] != "transform":
                x["bk"] = 1
            if pz and x["k"] not in ("tap", "phase") and not x.get("x"):
                # mudanças de zona à espera: entram no evento do registo que as explica, ou vão à frente dele
                for z in pz:
                    if absorbs(x, z):
                        x.setdefault("zn", []).append(z)
                    else:
                        put(zone_event(z), "")
                pz.clear()
            put(x, s)
            if x["k"] == "turn":
                turn_ev = ev[-1]
        pre.clear()
        return ev[-1]

    def put(x, s):
        if dirty:
            x["hd"] = {p: [n for _, n in hands[p]] for p in sorted(dirty)}
            x["lib"] = {p: lib[p] for p in sorted(dirty) if p in lib} or None
            dirty.clear()
        ev.append({"t": t, **{k: v for k, v in x.items() if v not in (None, "")}, "txt": s[:300]})

    def next_log(j):
        return next((l for l in lines[j + 1:] if not l.startswith("GRIMORIO|")), "")

    def grim(f, j):
        """Uma linha GRIMORIO|… do nosso lançador (ver build/forge/GrimorioSim.java)."""
        kind, side = f[1], {str(j + 1): x for j, x in enumerate(SIDES)}
        if kind == "H" and len(f) >= 4:  # mão e biblioteca no início do turno: a verdade, corrige tudo
            p = side.get(f[2])
            if p:
                lib[p] = int(f[3])
                hands[p] = [(int(i), canon(n)) for i, _, n in (x.partition(":") for x in f[4:])]
                dirty.add(p)
            return
        if kind == "Z" and len(f) >= 11:
            i, fp, tp = int(f[2]), side.get(f[3]), side.get(f[4])
            fz, tz, name = f[5].lower() or None, f[6].lower(), canon("|".join(f[10:]))
            if fz == tz:
                return
            id_name.setdefault(str(i), name)
            if tp or fp:
                id_side[str(i)] = tp or fp
            for zz, p, d in ((fz, fp, -1), (tz, tp, 1)):
                if p and zz == "hand":
                    hands[p] = hands[p] + [(i, name)] if d > 0 else [h for h in hands[p] if h[0] != i]
                    dirty.add(p)
                if p and zz == "library" and p in lib:
                    lib[p] += d
                    dirty.add(p)
            z = {"id": i, "card": name, "from": fz, "to": tz, "fp": fp, "tp": tp}
            if f[7] == "1":
                z["tok"] = 1
                kw = [k.capitalize().replace("_", " ") for k in f[9].split(",") if k]
                z.update({"pt": f[8]} if f[8] else {}, **({"kw": kw} if kw else {}))
            bf.discard(i)
            if tz == "battlefield":
                bf.add(i)
                z.update(wait.pop(i, {}))
            elif tz != "stack":
                wait.pop(i, None)
            if not t:
                return  # mão inicial e mulligans: só o estado da mão (vai no evento "mulligan")
            if fz == "stack" and tz != "battlefield":  # instantâneo/feitiço: a linha "Resolve Stack" já passou
                for x in reversed(ev[-6:]):
                    if x["k"] == "turn":
                        break
                    if x["k"] in ("resolve", "counter") and absorbs(x, z) and \
                            not any(y["from"] == "stack" for y in x.get("zn", ())):
                        x.setdefault("zn", []).append(z)
                        return
            if tz == "stack" or fz == "stack" or (fz == "hand" and tz in ("battlefield", "graveyard")):
                pz.append(z)  # o registo explica-a já a seguir (lançar, resolver, jogar terreno, descartar)
            else:
                emit(zone_event(z), "")
            return
        if kind == "L" and len(f) >= 5 and side.get(f[2]):  # eliminado (multijogador): o jogo continua sem ele
            p = side[f[2]]
            # quem o eliminou: o dono da jogada logo antes da última perda de vida/veneno (dano, ou dreno de um gatilho)
            j = next((k for k in range(len(ev) - 1, -1, -1) if ev[k]["k"] == "life" and ev[k].get("p") == p
                      or ev[k]["k"] in ("damage", "poison") and ev[k].get("target") == p), len(ev) - 1)
            by = next((x["p"] for x in reversed(ev[max(0, j - 12):j + 1]) if x.get("p") not in (None, p) and (
                x["k"] in ("damage", "poison") and x.get("target") == p or x["k"] in ("resolve", "trigger", "activate", "cast"))), None)
            out[p] = {"t": int(f[3]) if f[3].isdigit() else t, "by": by, "why": "|".join(f[4:])}
            emit({"k": "outcome", "p": p}, f"{pname.get(p, p)} {out[p]['why']}")
            return
        i = int(f[2]) if len(f) > 3 and f[2].isdigit() else None
        name, p = canon(f[-1]), id_side.get(f[2]) if len(f) > 2 else None
        if kind == "T" and i is not None and i in bf:
            if f[3] == "1":
                if f"({i})" not in next_log(j):  # a linha "Mana:"/"Combat:" a seguir já diz que virou
                    emit({"k": "tap", "p": p, "card": name, "id": i, "x": 1}, "")
            elif ph == "untap" and turn_ev is not None:
                turn_ev.setdefault("ut", []).append(i)  # passo de desvirar: vai no evento do turno
            else:
                emit({"k": "untap", "p": p, "card": name, "id": i, "x": 1}, "")
        elif kind == "C" and i is not None and len(f) >= 7:
            ct = f[3] if f[3][:1] in "+-" else f[3].lower()
            old, new = int(f[4]), int(f[5])
            if new == old:
                return
            if i in bf:
                emit({"k": "counters", "p": p, "card": name, "id": i, "ct": ct, "n": new - old, "abs": new, "x": 1}, "")
            else:  # a carta entra com marcadores (ainda na pilha): vão com ela para o campo
                wait.setdefault(i, {}).setdefault("ctr", {})[ct] = new
        elif kind == "A" and i is not None and len(f) >= 5 and f[3].isdigit():
            tid = int(f[3])
            if i in bf:
                emit({"k": "attach", "p": p, "card": name, "id": i, "target": canon(id_name.get(f[3])), "tid": tid,
                      "x": 1}, "")
            else:
                wait.setdefault(i, {})["att"] = tid


    def effects(desc, p, src, src_id):
        """Efeitos legíveis no texto de uma resolução -> eventos extra."""
        out = []
        plain = re.sub(r'"[^"]*"', "", desc)  # habilidades citadas ("gains '{T}: Create…'") não acontecem agora
        plain = re.sub(r"\s*\(Targeting:.*$", "", plain, flags=re.S)  # o texto do alvo (feitiço na pilha) não acontece
        for mm in () if exact else TOKEN.finditer(plain):  # jogo exato: fichas, marcadores, anexos, compras… vêm do Forge
            n = num(mm.group(1)) if mm.group(1) not in ("X", "that many") else None
            if mm.group(1) == "that many":
                x = re.search(r"Amount: (\d+)", desc)
                n = int(x.group(1)) if x else None
            name = (mm.group(4) or "").strip().rstrip(",").strip()
            if not name:
                continue  # "create a token that's a copy of …": o Forge não diz de quê
            if re.search(r"\bfor each\b[^.]*$", plain[:mm.start()]):
                n = None  # "for each card discarded this way, create …": quantidade desconhecida
            kw = [w.strip().capitalize() for w in re.split(r",| and ", mm.group(5) or "") if w.strip()]
            out.append({"k": "token", "p": p, "card": f"{name} Token", "n": n,
                        "pt": f"{mm.group(2)}/{mm.group(3)}" if mm.group(2) else None, "kw": kw or None})
        for mm in () if exact else COUNTERS.finditer(plain):
            who = mm.group(4)
            if who.startswith("each"):
                continue  # "each valid permanent": o Forge não diz quais
            n = num(mm.group(2)) * (-1 if mm.group(1).lower() == "remove" else 1)
            if who in ("this creature", "it"):
                out.append({"k": "counters", "p": p, "card": src, "id": src_id, "ct": mm.group(3), "n": n})
            else:
                out.append({"k": "counters", "p": p, "card": card(who), "id": cid(who), "ct": mm.group(3), "n": n})
        for mm in re.finditer(r"([A-Z][^.()\[]*? \(\d+\)) gets ([+-]\d+/[+-]\d+)\s+until end of turn", plain):
            out.append({"k": "pump", "p": p, "card": card(mm.group(1)), "id": cid(mm.group(1)), "pt": mm.group(2)})
        x = re.search(r"\bthis creature gets ([+-]\d+/[+-]\d+) until end of turn", plain)
        if x and src:
            out.append({"k": "pump", "p": p, "card": src, "id": src_id, "pt": x.group(1)})
        x = re.search(r"\bcreatures you control get ([+-]\d+/[+-]\d+) until end of turn", plain)
        if x:
            out.append({"k": "pump", "p": p, "all": 1, "pt": x.group(1)})
        x = not exact and re.search(r"\bAttach to (.+? \(\d+\))", desc)
        if x and src:
            out.append({"k": "attach", "p": p, "card": src, "id": src_id, "target": card(x.group(1)), "tid": cid(x.group(1))})
        tg = re.search(r"Targeting: \[?\[?(.+?)\]", desc)
        tgt = [(nm, i) for nm, i in ITEMS.findall(tg.group(1))] if tg else []
        for kind, rx in (("untap", r"\buntap target\b"), ("tap", r"(?<!un)\btap target\b"), ("goad", r"\bgoad target\b")):
            if not exact and re.search(rx, plain, re.I):
                for nm, i in tgt:
                    out.append({"k": kind, "p": id_side.get(i), "card": card(f"{nm} ({i})"), "id": int(i)})
        x = not exact and re.match(r"\s*Untap (.+? \(\d+\))\.?$", desc)
        if x:
            out.append({"k": "untap", "card": card(x.group(1)), "id": cid(x.group(1))})
        x = re.search(r"(" + preg.pattern + r") draws " + NUMS + r" cards?", desc) or \
            (None if re.search(r"\bunless\b|\bopponent draws\b", plain) else re.search(r"\b[Dd]raw " + NUMS + r" cards?", plain))
        if x and not exact:
            who = side_of(x.group(1)) if x.re.groups == 2 else p
            out.append({"k": "draw", "p": who or p, "n": num(x.group(x.re.groups))})
        x = re.search(r"(\S+) searches (?:their|his|her) library for [^,]+, puts? (?:it|them|that card) "
                      r"(onto the battlefield|into (?:their|his|her|its owner's) (hand|graveyard))", desc)
        if x and not exact:
            out.append({"k": "search", "p": side_of(x.group(1)) or p,
                        "to": "battlefield" if x.group(2).startswith("onto") else x.group(3)})
        x = not exact and re.search(r"\bmills? " + NUMS + r" cards?", plain)
        if x:
            out.append({"k": "mill", "p": p, "n": num(x.group(1))})
        for what, rx in (("monarch", r"\bbecomes? the monarch"), ("initiative", r"\btakes? the initiative"),
                         ("emblem", r"\bgets? an emblem"), ("energy", r"\{E\}")):
            if re.search(rx, plain) and not (what == "energy" and "pay" in plain.lower()):
                out.append({"k": "player", "p": p, "to": what, "card": src,
                            "n": plain.count("{E}") if what == "energy" else None})
        return out

    for j, raw in enumerate(lines):
        if raw.startswith("GRIMORIO|"):
            if t or raw.startswith(("GRIMORIO|Z", "GRIMORIO|H")):
                grim(raw.rstrip("\n").split("|"), j)
            continue
        if not raw.strip() or NOISE.search(raw):
            continue
        mm = re.match(r"^(Turn|Phase|Mana|Mulligan|Land|Add To Stack|Resolve Stack|Combat|Damage|Life|Zone Change|"
                      r"Discard|Replacement Effect|Player Control|Information|Game Outcome|Match Result|Ante): (.*)$", raw)
        if not mm:
            if re.match(r"^Ai\(\d\)-.* (didn't block|assigned) ", raw):  # continuação de um bloqueio
                mm = ("Combat", raw)
            elif ev and t and ev[-1]["txt"].endswith(" "):  # frase partida: "... divided to " + "Ai(2)-B (2 damage)."
                ev[-1]["txt"] = (ev[-1]["txt"] + raw.strip())[:300]
                continue
            else:
                continue
        else:
            mm = (mm.group(1), mm.group(2))
        kind, s = mm
        e, extra = None, []
        if kind == "Turn":
            x = re.match(r"Turn (\d+) \((.*)\)", s)
            if x:
                for me in mana_wait:  # mana que não pagou nada visível: fica para quem tinha o turno
                    me.setdefault("p", active)
                mana_wait = []
                t, active = int(x.group(1)), side_of(x.group(2))
                ph = shown_ph = "untap"
                e = {"k": "turn", "p": active}
        elif kind == "Phase":
            x = re.match(r".*'s (.+)$", s)
            ph, ph_txt = (PHASE.get(x.group(1), "combat"), s) if x else (ph, ph_txt)
            continue
        elif kind == "Mana":
            c, _, desc = s.partition(" - ")
            if "{T}" in desc:
                i = cid(c)
                p = id_side.get(str(i)) if i is not None else None
                me = emit({"k": "tap", "p": p, "card": card(c), "id": i}, s)
                if p is None:
                    mana_wait.append(me)
        elif kind == "Mulligan":
            x = re.search(r"(\d+) cards", s)
            e = {"k": "mulligan", "p": side_of(s), "n": int(x.group(1)) if x else None,
                 "card": "kept" if "kept" in s else "mulligan"}
        elif kind == "Land":
            x = re.search(r" played (.+)$", s)
            if x:
                p = side_of(s)
                mid = ID.search(x.group(1))
                if mid:
                    id_side[mid.group(1)] = p
                c = card(x.group(1))
                e = {"k": "land", "p": p, "card": c, "id": cid(x.group(1)), "tapped": 1 if c in tapped_next else None}
                tapped_next.discard(c)
        elif kind == "Replacement Effect":
            x = re.match(r"(.+?) enters tapped\.$", s)
            if x:
                tapped_next.add(canon(x.group(1)))
            x = re.match(r"(.+?) enters with " + NUMS + r" (\S+) counters? on it", s)
            if x and not exact:  # "Kaito enters with four loyalty counters on it." -> vai no próximo evento dessa carta
                ctr_next[canon(x.group(1))] = {x.group(3): num(x.group(2))}
            e = {"k": "other"}
        elif kind == "Add To Stack":
            x = re.match(r"(.*?) (cast|triggered|activated) (.+?)(?: targeting \[(.*)\])?$", s)
            if x:
                p, c = side_of(x.group(1)), card(x.group(3))
                if x.group(2) == "triggered" and (len(c) > 60 or "[" in c or "—" in c):
                    c = None  # gatilho descrito por extenso (ex.: Eminence) em vez do nome da carta
                last_caster[c] = p
                for me in mana_wait:  # a mana que acabou de ser gerada foi para este feitiço
                    me["p"] = p
                    if me.get("id") is not None:
                        id_side.setdefault(str(me["id"]), p)
                mana_wait = []
                tl = ITEMS.findall(x.group(4)) if x.group(4) else []
                k = {"cast": "cast", "triggered": "trigger", "activated": "activate"}[x.group(2)]
                tg = ", ".join(target(f"{nm} ({i})") for nm, i in tl) if tl else (x.group(4) and target(x.group(4)))
                if not tl and x.group(4) and len(x.group(4)) > 40:  # alvo = feitiço na pilha, que o Forge descreve pelo texto
                    sp = next((y for y in reversed(pst) if y["k"] == "cast" and y["card"] and y["p"] != p), None)
                    tg = sp["card"] if sp else tg
                pst.append({"k": k, "p": p, "card": c, "id": cid(x.group(3))})
                e = {"k": k, "p": p, "card": c, "id": cid(x.group(3)),
                     "target": tg,
                     "tid": int(tl[0][1]) if len(tl) == 1 else None}
        elif kind == "Resolve Stack":
            c, sep, desc = s.partition(" - ")
            info = preg.match(s)  # "Ai(1)-A scried/surveiled …": informação, não é uma resolução
            if info:
                x = re.search(r"(\d+) card\(s\) to the graveyard", s)
                if x and not exact:
                    extra.append({"k": "mill", "p": side_of(s), "n": int(x.group(1))})
                e = {"k": "other", "p": side_of(s)}
            elif s.endswith("ability fizzles."):
                e = {"k": "other", "card": card(s[:-len(" ability fizzles.")])}
            else:
                find = lambda f: next((j for j in range(len(pst) - 1, -1, -1) if f(pst[j])), None)
                pos = None
                if sep:
                    c = card(c)
                    pos = find(lambda x: x["card"] == c)
                    if pos is None and not ID.search(s.partition(" - ")[0]) and len(c) > 40:
                        sep, c = "", None  # texto de gatilho com " - " pelo meio
                if not sep:
                    c = canon(s.strip())
                    pos = find(lambda x: x["k"] == "cast" and x["card"] == c)  # permanente sem texto: "Rest in Peace"
                    if pos is None:  # resolução de um gatilho: é o do topo da pilha
                        c = None
                        pos = find(lambda x: x["k"] != "cast")
                top = pst.pop(pos) if pos is not None else {}
                p = top.get("p") or last_caster.get(c)
                src = c or top.get("card")
                k = "counter" if sep and (re.match(r"\s*counter\b", desc, re.I) or "counter target" in desc.lower()) else "resolve"
                pt = re.match(r"(?:\w+ )*Creature (-?[\dX*]+) / (-?[\dX*]+)", desc) if sep else None
                e = {"k": k, "p": p, "card": c, "id": cid(s.partition(" - ")[0]) if sep else None,
                     "pt": f"{pt.group(1)}/{pt.group(2)}" if pt else None}
                extra = effects(desc if sep else s, p, src, top.get("id") or (cid(s.partition(" - ")[0]) if sep else None))
        elif kind == "Combat":
            x = re.match(r"(.*?) assigned (.+) to (attack|block) (.+?)\.?$", s)
            if x:
                p = side_of(x.group(1))
                tg = x.group(4)
                for nm, i in ITEMS.findall(x.group(2)):
                    card(f"{nm} ({i})")
                    id_side[i] = p
                    emit({"p": p, "k": x.group(3), "card": canon(id_name[i]), "id": int(i), "target": target(tg),
                          "tid": cid(tg.rstrip("."))}, s)
            continue
        elif kind == "Damage":
            x = re.match(r"(.+?) deals (\d+) (?:(combat|non-combat) )?damage( \(.*?\))? to (.+?)(\(as poison counters\))?\.?$", s)
            if x:
                c = card(x.group(1))
                tg = x.group(5).strip()
                e = {"k": "damage", "p": owner(x.group(1), c), "card": c, "id": cid(x.group(1)), "n": int(x.group(2)),
                     "target": target(tg), "tid": cid(tg.rstrip(".")),
                     "combat": 1 if x.group(3) == "combat" or (x.group(3) is None and ph == "combat") else None,
                     "dt": 1 if x.group(4) and "Deathtouch" in x.group(4) else None,
                     "psn": 1 if x.group(6) else None}
                if x.group(4) and "-1/-1" in x.group(4):  # murchar/infetar em criaturas: contadores, não dano
                    e["k"], e["ct"] = "counters", "-1/-1"
                    e["card"], e["id"], e["p"] = e["target"], e["tid"], None
            else:
                x = re.match(r"(.+?) receives (\d+) poison counter from (.+)$", s)
                if x:
                    c = card(x.group(3))
                    e = {"k": "poison", "p": owner(x.group(3), c), "card": c, "n": int(x.group(2)),
                         "target": side_of(x.group(1))}
        elif kind == "Life":
            x = re.match(r"(?:Life: )?(.+) (-?\d+) > (-?\d+)$", s)
            if x:
                p = side_of(x.group(1))
                start_life.setdefault(p, int(x.group(2)))
                e = {"k": "life", "p": p, "n": int(x.group(3))}
        elif kind == "Zone Change":
            x = re.match(r"(.+?) was put into (\w+) from (\w+)", s)
            if x and exact:
                pass  # repetida: a linha GRIMORIO|Z anterior já a fez
            elif x:
                to, frm = x.group(2).lower(), x.group(3).lower()
                c = card(x.group(1))
                # battlefield>graveyard = morreu/destruída/sacrificada (fetches incluídas)
                k = "destroy" if to == "graveyard" and frm == "battlefield" else "exile" if to == "exile" else \
                    "bounce" if to == "hand" and frm == "battlefield" else "other"
                e = {"k": k, "p": owner(x.group(1), c), "card": c, "id": cid(x.group(1)), "target": f"{frm}>{to}"}
            else:
                x = re.match(r"Send countered spell to (\w+)", s)
                e = {"k": "countered", "to": x.group(1).lower()} if x else {"k": "other"}
        elif kind == "Discard":
            x = re.search(r" discards (.+?)\.?$", s)
            e = {"k": "discard", "p": side_of(s), "card": card(x.group(1)) if x else None,
                 "id": cid(x.group(1)) if x else None}
        elif kind == "Game Outcome":
            x = re.match(r"Turn (\d+)$", s)
            if x:
                turns = int(x.group(1))
            elif " has lost " in s:
                reason = s
                e = None if side_of(s) in out else {"k": "outcome", "p": side_of(s)}  # já eliminado a meio do jogo
            elif " has won" in s:
                e = {"k": "outcome", "p": side_of(s)}
        elif kind == "Information":
            e = {"k": "other"}
        if e is not None:
            emit(e, s)
        for x in extra:
            emit(x, s)
    for me in mana_wait:
        me.setdefault("p", active)
    for z in pz:
        put(zone_event(z), "")
    if dirty and ev:
        ev[-1]["hd"] = {p: [n for _, n in hands[p]] for p in dirty}
    if not exact:
        _post(ev, cmd, set(pnames.values()))
    x = re.search(r"in (\d+) ms\. (.+) has won!", result) or re.search(r"Took (\d+) ms", result)
    if x:
        ms = int(x.group(1))
        if x.re.groups == 2:
            winner = side_of(x.group(2)) or "draw"
    # o Forge rebentou a meio (ex.: «Couldn't map Masked Vandal» na simulação de jogadas) e deu o jogo a alguém sem
    # ninguém perder: não conta como vitória nem derrota
    crash = None if reason else next((l.strip() for l in lines if re.search(r"^(java\.lang\.|Exception in |\w+(Exception|Error): )", l.strip())), None)
    if crash:
        winner, reason = "draw", f"Jogo interrompido: o Forge falhou a meio ({crash[:140]})"
    multi = {}
    if len(pnames) > 2:  # lugares: o vencedor, os outros que ficaram em jogo, depois os eliminados do último ao primeiro
        alive = [x for x in pnames.values() if x not in out]
        multi = {"turns": t, "places": sorted(alive, key=lambda x: x != winner) + list(out)[::-1], "out": out}
    return {"winner": winner, "crashed": bool(crash), "turns": turns or (t + 1) // 2, "ms": ms, "reason": reason, **multi,
            "events": ev, "summary": summarize(ev, t, start_life, "".join(sorted(set(pnames.values())))), **({"exact": True} if exact else {})}


ONFIELD = ("attack", "block", "tap", "untap", "attach", "pump", "counters", "transform", "goad",
           "destroy", "exile", "bounce", "other")


def _post(ev, cmd, sides=("a", "b")):
    """Segunda passagem, com o jogo todo à vista:
    - damage.gone = o alvo (criatura) nunca mais aparece em jogo nem sai por uma linha "Zone Change" -> morreu
      por dano (o Forge não regista essas mortes);
    - turn.reveal = cartas que cada lado joga/descarta da mão até ao turno seguinte (estavam na mão)."""
    seen_after = set()  # ids que aparecem em jogo a partir daqui (percorre de trás para a frente)
    hit_back = {}  # id -> turnos em que causa dano de combate (o dano é simultâneo: no mesmo turno não prova nada)
    for e in reversed(ev):
        if e["k"] == "damage" and e.get("tid") is not None and e["tid"] not in seen_after \
                and all(tt == e["t"] for tt in hit_back.get(e["tid"], ())):
            e["gone"] = 1
        if e["k"] in ONFIELD and e.get("id") is not None:
            seen_after.add(e["id"])
        if e["k"] == "damage":
            if e.get("combat") and e.get("id") is not None:
                hit_back.setdefault(e["id"], set()).add(e["t"])
            if e.get("tid") is not None:
                seen_after.add(e["tid"])
        if e["k"] == "attack" and e.get("tid") is not None:
            seen_after.add(e["tid"])
    turn_ev, out = None, {}
    for e in ev + [{"k": "turn"}]:
        if e["k"] == "turn":
            if turn_ev is not None:
                rv = {s: v for s, v in out.items() if v}
                if rv:
                    turn_ev["reveal"] = rv
            turn_ev, out = (e if "t" in e else None), {}
        elif e["k"] in ("land", "cast", "discard") and e.get("p") in sides and e.get("card"):
            if e["k"] == "cast" and e["card"] in cmd.get(e["p"], ()):
                continue
            out.setdefault(e["p"], []).append(e["card"])


def summarize(ev, last_t, start_life=None, sides="ab"):
    """Resumo barato para relatórios (MVP, cartas mortas, falta de terrenos, turno da vitória).
    sides: os lados do jogo ("abcd" com 4 jogadores); life = [[vida de cada lado, pela ordem]] no fim de cada turno."""
    S = {s: {"mulligans": 0, "kept": None, "lands": [], "missed_land_drops": 0, "spells": 0, "cast": [],
             "first_cast": {}, "damage_by_card": {}, "damage_to_creatures": {}, "poison_by_card": {}, "attacks": 0,
             "used": set(), "first_damage_turn": None, "turns_taken": 0} for s in sides}
    life = {**{x: 20 for x in sides}, **(start_life or {})}  # vida inicial: o "antes" da 1.ª mudança
    life_by_turn = []
    cur_t = 0

    def close_turn():
        if cur_t:
            life_by_turn.append([life[x] for x in sides])

    for e in ev:
        p, k, c = e.get("p"), e["k"], e.get("card")
        if e["t"] != cur_t:
            close_turn()
            for _ in range(cur_t + 1, e["t"]):
                life_by_turn.append([life[x] for x in sides])
            cur_t = e["t"]
        if k == "life" and p:
            life[p] = e["n"]
            continue
        if p not in S:
            continue
        s = S[p]
        if k == "turn":
            s["turns_taken"] += 1
            s["lands"].append(0)
        elif k == "mulligan":
            if c == "kept":
                s["kept"] = e.get("n")
            else:
                s["mulligans"] += 1
        elif k == "land":
            if s["lands"]:
                s["lands"][-1] += 1
            s["used"].add(c)
        elif k == "cast":
            s["spells"] += 1
            s["cast"].append([e["t"], c])
            s["first_cast"].setdefault(c, e["t"])
            s["used"].add(c)
        elif k in ("attack", "trigger", "activate"):
            s["used"].add(c)
            s["attacks"] += k == "attack"
        elif k in ("damage", "poison") and c:
            s["used"].add(c)
            if e.get("target") in S and e.get("target") != p:  # dano a um adversário (terrenos de dor não contam)
                key = "poison_by_card" if k == "poison" or e.get("psn") else "damage_by_card"
                s[key][c] = s[key].get(c, 0) + e["n"]
                if s["first_damage_turn"] is None:
                    s["first_damage_turn"] = e["t"]
            elif e.get("target") not in S:
                s["damage_to_creatures"][c] = s["damage_to_creatures"].get(c, 0) + e["n"]
    close_turn()
    for s in S.values():
        s["missed_land_drops"] = s["lands"][:6].count(0)  # 6 primeiros turnos próprios
        s["lands_total"] = sum(s["lands"])
        s["used"] = sorted(x for x in s["used"] if x)
        s["mvp"] = max(s["damage_by_card"], key=s["damage_by_card"].get, default=None)
    return {**S, "life": life_by_turn, "last_turn": last_t}


# ---------- trabalhos ----------

JOBS, PENDING = {}, []
LOCK = threading.Condition()
_worker = None


def submit(data_dir, body):
    """Valida o pedido, cria os .dck e põe o trabalho na fila. Devolve o id."""
    fmt = str(body.get("format") or "modern").lower()
    gtype = GAME_TYPE.get(fmt, "Constructed")
    mode = str(body.get("mode") or "1v1")
    if mode not in MODES:
        raise ValueError("Modo de jogo desconhecido.")
    n, teams = MODES[mode]
    seats = body.get("seats")
    if seats is None:  # forma antiga (1 contra 1): {a, b, difficulty_a, difficulty}
        seats = [{"deck": body.get("a"), "difficulty": body.get("difficulty_a")},
                 {"deck": body.get("b"), "difficulty": body.get("difficulty")}]
    if not isinstance(seats, list) or len(seats) != n or not all(isinstance(x, dict) for x in seats):
        raise ValueError(f"Este modo de jogo precisa de {n} decks.")
    sides = SIDES[:n]
    casual = bool(body.get("casual"))
    try:
        games, clock = int(body.get("games") or 1), int(body.get("clock") or 120)
    except (TypeError, ValueError):
        raise ValueError("Jogos e relógio têm de ser números.")
    cap = 900 if n == 2 else 1800  # uma mesa de Commander a quatro joga muitos mais turnos
    if not 1 <= games <= 10:
        raise ValueError("Número de jogos tem de estar entre 1 e 10.")
    if not 30 <= clock <= cap:
        raise ValueError(f"O relógio tem de estar entre 30 e {cap} segundos.")
    profs = {d[0]: d[1] for d in DIFFICULTIES}
    prof = [profs.get(x.get("difficulty") or "default") for x in seats]
    if not all(prof[1:]):
        raise ValueError("Dificuldade desconhecida.")
    prof[0] = prof[0] or "Default"  # o bot do teu deck
    search = [SEARCH.get(x.get("difficulty") or "default", "none") for x in seats]
    # a 3–4 jogadores a simulação de jogadas do Forge (Forte) rebenta depois da 1.ª eliminação e o jogo acabava com os
    # sobreviventes todos «vencedores» (empates nas mesas de Commander): aí joga-se com a lógica Normal
    forte_off = n > 2 and any(x != "none" for x in search)
    if forte_off:
        search = ["none"] * n
    if (n > 2 or casual or any(x != "none" for x in search)) and \
            not os.path.isfile(os.path.join(os.path.dirname(forge_dir(data_dir)), "forge-ext", "GrimorioSim.class")):
        raise ValueError("A dificuldade Forte, os jogos a 3–4 e o modo casual precisam do lançador do Grimório (build/forge/build.sh).")
    if any(x != "none" for x in search):
        clock = min(cap, clock * SEARCH_CLOCK)
    decks = {}
    for side, x in zip(sides, seats):
        d = x.get("deck")
        if not isinstance(d, dict) or not isinstance(d.get("main"), dict) or not d["main"]:
            raise ValueError(f"Falta o deck {side.upper()}.")
        for sec in ("main", "side"):
            v = d.get(sec) or {}
            if not isinstance(v, dict) or len(v) > 300 or \
                    any(not isinstance(n, str) or len(n) > 200 or not isinstance(q, int) or not 0 <= q <= 250
                        for n, q in v.items()):
                raise ValueError(f"Deck {side.upper()}: lista inválida.")
        if gtype != "Constructed" and not casual and not d.get("commanders"):
            raise ValueError(f"Deck {side.upper()}: falta o comandante.")
        decks[side] = d
    fdir = forge_dir(data_dir)
    names = forge_names(fdir, os.path.join(data_dir, "forge-run"))
    jid = uuid.uuid4().hex[:12]
    jdir = os.path.join(data_dir, "forge-run", "jobs", jid)
    os.makedirs(os.path.join(jdir, "decks"))
    os.makedirs(os.path.join(jdir, "home"))
    unknown = []
    for side in sides:
        dtype = ("Commander" if decks[side].get("commanders") else "Constructed") if casual else gtype
        txt, unk = to_dck(decks[side], side.upper(), dtype, names)
        unknown += [{"side": side, "card": n} for n in unk]
        with open(os.path.join(jdir, "decks", f"{side}.dck"), "w", encoding="utf-8") as f:
            f.write(txt)
    cards = {s: list(decks[s].get("commanders") or []) + list(decks[s]["main"]) + list(decks[s].get("side") or {})
             for s in sides}
    job = {"id": jid, "status": "queued", "position": 0, "error": None, "games": [], "unknown": unknown,
           "format": fmt, "game_type": gtype, "difficulty": seats[1].get("difficulty") or "default", "created": time.time(),
           "mode": mode, **({"casual": True} if casual else {}),
           # quem e o quê (o Laboratório vê os seus jogos a decorrer noutro separador/dispositivo: active())
           "src": body.get("_src"), "owner": body.get("_owner"), "names": {s: str(decks[s].get("name") or s.upper())[:80] for s in sides},
           "_args": {"dir": jdir, "games": games, "clock": clock, "profiles": prof, "gtype": gtype,
                     "search": search, "teams": teams, "mode": mode, **({"forte_off": True} if forte_off else {}),
                     "forge": fdir, "cards": cards,
                     **({"cmd_seats": [int(bool(decks[s].get("commanders"))) for s in sides],
                         "life": [base_life(fmt, n)] * n} if casual else {}),
                     "setup": {s: {"commanders": list(decks[s].get("commanders") or []),
                                   "size": sum(decks[s]["main"].values())} for s in sides}}}
    global _worker
    with LOCK:
        for k in [k for k, j in JOBS.items() if j["status"] in ("done", "error") and time.time() - j["created"] > 3600]:
            del JOBS[k]
        JOBS[jid] = job
        # prioridade: os trabalhos de fundo (background=True, a Arena) vão para o fim; os teus passam-lhes à frente
        # (o que está a jogar é cancelado pela própria Arena quando vê trabalhos teus: ratings.others_busy)
        job["_bg"] = bool(body.get("background"))
        PENDING.insert(len(PENDING) if job["_bg"] else next((i for i, k in enumerate(PENDING) if JOBS[k].get("_bg")), len(PENDING)), jid)
        if _worker is None:
            _worker = threading.Thread(target=worker, args=(data_dir,), daemon=True)
            _worker.start()
        LOCK.notify()
    return jid


def status(jid):
    with LOCK:
        j = JOBS.get(jid)
        if not j:
            return None
        out = {k: v for k, v in j.items() if not k.startswith("_")}
        if j["status"] == "queued":
            out["position"] = PENDING.index(jid) + 1
        return out


def active(owner):
    """Jogos do Laboratório (de um dono) na fila ou a jogar: para os ver ao vivo noutro separador ou dispositivo."""
    with LOCK:
        return [{"id": j["id"], "status": j["status"], "names": j.get("names") or {}, "format": j.get("format"), "mode": j.get("mode"),
                 "created": j["created"], **({"position": PENDING.index(k) + 1} if k in PENDING else {})}
                for k, j in JOBS.items() if j.get("src") == "lab" and j.get("owner") == owner and j["status"] in ("queued", "running")]


def cancel(jid):
    """Tira o trabalho da fila ou mata o contentor se já está a jogar (o trabalho acaba em erro)."""
    with LOCK:
        j = JOBS.get(jid)
        if not j or j["status"] in ("done", "error"):
            return
        if jid in PENDING:
            PENDING.remove(jid)
            j.update(status="error", error="Cancelado.")
            shutil.rmtree(j["_args"]["dir"], ignore_errors=True)
            return
        p = PROCS.get(jid)
    if RUNTIME == "docker":
        subprocess.run(["docker", "kill", PREFIX + jid], capture_output=True)
    elif p:
        p.kill()


def docker_kill_all():
    if RUNTIME != "docker":
        return
    ids = subprocess.run(["docker", "ps", "-q", "--filter", f"name={PREFIX}"],
                         capture_output=True, text=True).stdout.split()
    if ids:
        subprocess.run(["docker", "kill", *ids], capture_output=True)


def worker(data_dir):
    docker_kill_all()  # sobras de um servidor anterior que morreu a meio
    jobs_root = os.path.join(data_dir, "forge-run", "jobs")
    with LOCK:
        live = set(PENDING)
    for d in os.listdir(jobs_root) if os.path.isdir(jobs_root) else []:
        if d not in live:
            shutil.rmtree(os.path.join(jobs_root, d), ignore_errors=True)
    PAR["sched"] = load_sched(data_dir)
    PAR["n"] = PAR["sched"]["parallel"]
    while True:
        with LOCK:  # até PAR["n"] jogos ao mesmo tempo; um jogo extra só arranca com RAM livre (MEM_MIN)
            while not PENDING or len(RUNNING) >= PAR["n"] or (RUNNING and mem_free() < MEM_MIN):
                LOCK.wait(timeout=5)
            jid = PENDING.pop(0)
            job = JOBS[jid]
            job["status"] = "running"
            RUNNING.add(jid)
        threading.Thread(target=run_job, args=(jid, job), daemon=True).start()


def run_job(jid, job):
    try:
        job["games"] = redo_crashed(jid, job["_args"], run_forge(jid, job["_args"]))
        job["status"] = "done"
    except Exception as e:
        job["error"] = str(e) if isinstance(e, RuntimeError) else "Falha inesperada no simulador."
        job["status"] = "error"
        print(f"[sim {jid}] {e!r}", file=sys.stderr, flush=True)
    finally:
        shutil.rmtree(job["_args"]["dir"], ignore_errors=True)
        with LOCK:
            RUNNING.discard(jid)
            LOCK.notify_all()


# ---------- jogos do Forge em simultâneo (definição: 1, 2 ou 3) ----------
MAX_PAR = 6  # jogos do Forge ao mesmo tempo (a RAM decide o resto: um jogo extra só arranca com MEM_MIN livres)
SCHED0 = {"parallel": 1, "dist": "antigo", "quota": 0, "arena": False}
ARENA_ON = {"on": False}  # a Arena está ligada (ratings.py): com sched["arena"], os torneios deixam-lhe um lugar
RUNNING, PAR, MEM_MIN = set(), {"n": 1, "sched": dict(SCHED0)}, 1500  # MB livres para arrancar um jogo extra (cada jogo ~0,7–1 GB)


def mem_free():
    if os.name == "nt":  # sem /proc: GlobalMemoryStatusEx
        import ctypes

        class MS(ctypes.Structure):
            _fields_ = [("len", ctypes.c_ulong), ("load", ctypes.c_ulong)] + [(k, ctypes.c_ulonglong) for k in
                        ("total", "avail", "ptotal", "pavail", "vtotal", "vavail", "xavail")]
        m = MS(len=ctypes.sizeof(MS))
        return m.avail // 1048576 if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m)) else 0
    try:
        with open("/proc/meminfo") as f:
            return int(next(l for l in f if l.startswith("MemAvailable")).split()[1]) // 1024
    except (OSError, StopIteration, ValueError):
        return 0




def load_sched(data_dir):
    """Definições do simulador: parallel (1–6 jogos ao mesmo tempo); dist = que torneio tem prioridade ('antigo' ou
    'recente'); quota = jogos no máximo por torneio antes de passar ao seguinte (0 = todos: enche um de cada vez);
    arena = a Arena joga durante os torneios, com um dos lugares."""
    try:
        with open(os.path.join(data_dir, "sim-settings.json")) as f:
            j = json.load(f)
    except (OSError, ValueError, TypeError):
        j = {}
    return clean_sched({**SCHED0, **(j if isinstance(j, dict) else {})})


def clean_sched(j):
    try:
        n = max(1, min(MAX_PAR, int(j.get("parallel", 1))))
        q = max(0, min(MAX_PAR, int(j.get("quota", 0))))
    except (ValueError, TypeError):
        n, q = 1, 0
    return {"parallel": n, "dist": "recente" if j.get("dist") == "recente" else "antigo", "quota": q, "arena": bool(j.get("arena"))}


def load_parallel(data_dir):
    return load_sched(data_dir)["parallel"]


def busy_slots():
    """Lugares do simulador ocupados: jogos a correr e na fila (testes, torneios e Arena)."""
    with LOCK:
        return len(RUNNING) + len(PENDING)


def settings(data_dir, new=None):
    """GET/POST das definições do simulador: {"parallel": 1–6, "dist", "quota", "arena", "running": n, "mem_free": MB}."""
    cur = load_sched(data_dir)
    if new is not None:
        cur = clean_sched({**cur, **{k: v for k, v in new.items() if k in SCHED0}})
        with open(os.path.join(data_dir, "sim-settings.json"), "w") as f:
            json.dump(cur, f)
        with LOCK:
            PAR.update(n=cur["parallel"], sched=cur)
            LOCK.notify_all()
    else:
        PAR["n"] = PAR["n"] if _worker else cur["parallel"]
        PAR["sched"] = cur
    return {**cur, "parallel": PAR["n"], "max": MAX_PAR, "running": len(RUNNING), "mem_free": mem_free(), "mem_min": MEM_MIN}


def redo_crashed(jid, a, games):
    """A simulação de jogadas do Forge (Forte) rebenta com certas cartas (ex.: Masked Vandal, «Couldn't map»):
    esses jogos repetem-se com a IA Normal e o registo diz porquê."""
    if a.get("forte_off"):
        for g in games:
            g["events"].insert(0, {"k": "other", "txt": "Forte a 3–4 jogadores joga como Normal: a simulação de jogadas do Forge falha depois de uma eliminação."})
    bad = [g for g in games if g.get("crashed")]
    if not bad or not any(x != "none" for x in a.get("search", ())):
        return games
    redo = run_forge(jid, {**a, "search": ["none"] * len(a["search"]), "games": len(bad)})
    note = "Forte desligado neste jogo: o Forge não conseguiu simular as jogadas com uma das cartas e jogou-se com a Normal."
    for g in redo:
        g["note"] = note
        g["events"].insert(0, {"k": "other", "txt": note})
    return [g for g in games if not g.get("crashed")] + redo


def cmd_of(a):
    return {s: v["commanders"] for s, v in (a.get("setup") or {}).items()}


def publish_live(jid, buf, a):
    """Jogo em curso (depois do último «Game Result») -> job["live"] = {done, events}."""
    try:
        done = sum(1 for l in buf if l.startswith("Game Result:"))
        last = max((i for i, l in enumerate(buf) if l.startswith("Game Result:")), default=-1)
        head = next((l for l in buf if re.match(r"^Ai\(1\)-.* vs Ai\(2\)-", l)), None)
        cur = ([head] if head and last >= 0 else []) + buf[last + 1:]
        ev = parse_game(cur, "", a["cards"], cmd_of(a))["events"] if cur else []
        with LOCK:
            if jid in JOBS:
                JOBS[jid]["live"] = {"done": done, "events": ev}
    except Exception:
        pass  # a vista ao vivo é um extra; o resultado final não depende dela


def multi_result(g, a):
    """3–4 jogadores: modo e equipas no jogo; em equipas, `winner` = "a" quando ganha a tua equipa (mesmo que o teu
    deck tenha sido eliminado), senão o lado que o Forge deu como vencedor."""
    if len(a.get("setup") or {}) > 2:
        g["mode"] = a.get("mode")
        # todos contra todos não pode acabar com vários vencedores: o Forge parou o jogo a meio (erro ou tempo)
        if not a.get("teams") and not g.get("crashed") and sum("has won because" in (e.get("txt") or "") for e in g["events"]) > 1:
            g.update(crashed=True, winner="draw", reason="Jogo interrompido: o Forge parou-o com vários jogadores ainda em jogo")
    if a.get("teams"):
        g["teams"] = dict(zip(SIDES, a["teams"]))
        if g["winner"] in g["teams"] and g["teams"][g["winner"]] == g["teams"]["a"]:
            g["winner"] = "a"
    return g


def run_forge(jid, a):
    name = PREFIX + jid
    # o nosso lançador (build/forge/GrimorioSim.java) quando está compilado: mesmo jogo + eventos exatos e registo ao vivo
    ext = os.path.join(os.path.dirname(a["forge"]), "forge-ext")
    use_ext = os.path.isfile(os.path.join(ext, "GrimorioSim.class"))
    jvm = ["-Xmx2g", "-Djava.awt.headless=true", "-Dfile.encoding=UTF-8"]
    if RUNTIME == "local":  # o mesmo jogo sem contentor: cwd = Forge (lê res/ relativo), home própria por trabalho
        return _play(jid, a, [JAVA, *jvm, f"-Duser.home={os.path.join(a['dir'], 'home')}",
                                   *(["-cp", os.pathsep.join([os.path.join(a["forge"], FORGE_JAR), ext]), "GrimorioSim"]
                                     if use_ext else ["-jar", os.path.join(a["forge"], FORGE_JAR)])],
                          os.path.join(a["dir"], "decks"), use_ext)
    cmd = ["docker", "run", "--rm", "--name", name, "-m", "3g", "--cpus", "2",
           "--user", f"{os.getuid()}:{os.getgid()}", "-e", "HOME=/run/home",
           "-v", f"{a['forge']}:/forge:ro", "-v", f"{a['dir']}:/run", "-w", "/forge"]
    if use_ext and os.path.isdir(os.path.join(ext, "ai")):
        cmd += ["-v", f"{os.path.join(ext, 'ai')}:/forge/res/ai:ro"]  # os nossos perfis (chances 10%–90%)
    if use_ext and os.path.isdir(os.path.join(ext, "cardsfolder")):  # zip do Forge + as nossas cartas (build/forge/cards)
        cmd += ["-v", f"{os.path.join(ext, 'cardsfolder')}:/forge/res/cardsfolder:ro"]
    cmd += ["-v", f"{ext}:/ext:ro", IMAGE, "java", *jvm, "-cp", f"{FORGE_JAR}:/ext", "GrimorioSim"] if use_ext else \
        [IMAGE, "java", *jvm, "-jar", FORGE_JAR]
    return _play(jid, a, cmd, "/run/decks", use_ext, name)


def _play(jid, a, cmd, decks, use_ext, container=None):
    """Junta os argumentos do jogo a `cmd` (java local ou docker run), corre e lê o registo.
    container: nome do contentor a matar no fim do tempo (docker); sem ele mata-se o processo java."""
    sides = SIDES[:len(a["profiles"])]
    cmd += ["sim", "-D", decks, "-d", *[f"{x}.dck" for x in sides], "-n", str(a["games"]), "-c", str(a["clock"]),
            "-a", *a["profiles"]]
    if a.get("teams"):
        cmd += ["-T", *map(str, a["teams"])]
    if a.get("cmd_seats"):  # modo casual: quem tem comandante e a vida das regras base
        cmd += ["-C", *map(str, a["cmd_seats"]), "-L", *map(str, a["life"])]
    if a["gtype"] != "Constructed":
        cmd += ["-f", a["gtype"]]
    if use_ext and any(x != "none" for x in a.get("search", ())):
        cmd += ["-S", *a["search"]]
    timeout = a["clock"] * a["games"] + TIMEOUT_PAD
    home = os.path.join(a["dir"], "home")  # Windows: o Forge guarda o perfil em %APPDATA%\Forge -> um por trabalho
    env = None if container else {**os.environ, "APPDATA": home, "LOCALAPPDATA": home}
    try:
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                             errors="replace", cwd=None if container else a["forge"], env=env)
    except OSError as e:  # sem java/docker, ou a pasta do Forge não existe
        raise RuntimeError(f"Não consegui arrancar o Forge ({cmd[0]}): {e.strerror or e}. "
                           + ("Instala o Docker ou usa GRIMORIO_RUNTIME=local." if container else
                              "Instala o Java 17 ou indica-o em GRIMORIO_JAVA."))
    PROCS[jid] = p
    killed = []

    def kill():
        killed.append(1)
        if container:
            subprocess.run(["docker", "kill", container], capture_output=True)
        p.kill()
    watchdog = threading.Timer(timeout, kill)
    watchdog.start()
    # Lê a saída à medida que o Forge joga: o jogo em curso fica em job["live"] para o browser ver ao vivo.
    buf, last = [], 0.0
    try:
        for line in p.stdout:
            buf.append(line.rstrip("\n"))
            if line.startswith("Game Result:") or time.time() - last > 0.5:
                last = time.time()
                publish_live(jid, buf, a)
        p.wait()
    finally:
        watchdog.cancel()
        PROCS.pop(jid, None)
    out = "\n".join(buf)
    if killed:
        raise RuntimeError(f"O Forge não terminou em {timeout} s e foi parado.")
    if "Could not load deck" in out:
        raise RuntimeError("O Forge não conseguiu ler um dos decks.")
    games = [multi_result({**parse_game(lines, res, a["cards"], cmd_of(a)), "setup": a.get("setup")}, a)
             for lines, res in split_games(out)]
    with open(os.path.join(os.path.dirname(os.path.dirname(a["dir"])), "last.log"), "w", encoding="utf-8") as f:
        f.write(out)  # saída crua do último trabalho, para depuração
    if not games:
        print(f"[sim {jid}] saída sem jogos:\n{out[-3000:]}", file=sys.stderr, flush=True)
        raise RuntimeError("O Forge terminou sem jogar (código %s)." % p.returncode)
    return games


# ---------- adversários prontos ----------

def get_json(url, timeout=20):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return json.load(r)


def cached(path, days, fetch):
    if os.path.isfile(path) and time.time() - os.path.getmtime(path) < days * 86400:
        with open(path) as f:
            return json.load(f)
    try:
        d = fetch()
    except Exception:
        if os.path.isfile(path):  # sem rede: serve o que houver
            with open(path) as f:
                return json.load(f)
        raise
    with open(path + ".tmp", "w") as f:
        json.dump(d, f, ensure_ascii=False)
    os.replace(path + ".tmp", path)
    return d


def parse_mtgo(text):
    """Texto MTGO ("4 Nome" ... "Sideboard" ...) -> (main, side)."""
    main, side = {}, {}
    cur = main
    for line in text.splitlines():
        line = line.strip()
        if line.lower().startswith("sideboard"):
            cur = side
            continue
        m = re.match(r"(?:SB:\s*)?(\d+)x?\s+(.+)", line)
        if m:
            n = re.sub(r"\s*/{1,2}\s*", " // ", m.group(2).strip())
            cur[n] = cur.get(n, 0) + int(m.group(1))
    return main, side


def opponents(data_dir, fmt, top=12):
    if fmt in META_FORMATS:
        meta_dir = os.path.join(data_dir, "meta")
        try:
            with open(os.path.join(meta_dir, f"{fmt}.json")) as f:
                archs = json.load(f)["archetypes"]
            with open(os.path.join(meta_dir, f"{fmt}.decks.json")) as f:
                ids = json.load(f)
        except (OSError, ValueError, KeyError):
            return []
        out = []
        for a in sorted(archs, key=lambda a: -a["share"]):
            d = next((d for d in ids.get(a["name"], []) if os.path.isfile(os.path.join(meta_dir, "raw", f"{d}.txt"))), None)
            if d:
                out.append({"id": f"{fmt}-{d}", "name": a["name"], "source": "MTGTop8", "archetype": a["name"],
                            "share": a["share"]})
            if len(out) >= top:
                break
        return out
    if fmt in EDH_FORMATS:
        cache_dir = os.path.join(data_dir, "edhrec")
        os.makedirs(cache_dir, exist_ok=True)

        def fetch():
            cl = get_json("https://json.edhrec.com/pages/commanders/year.json")["container"]["json_dict"]["cardlists"]
            return [{"slug": c["sanitized"], "name": c["name"], "decks": c.get("num_decks", 0)}
                    for c in cl[0]["cardviews"][:30]]
        try:
            cmds = cached(os.path.join(cache_dir, "sim-commanders.json"), 7, fetch)
        except Exception:
            return []
        total = sum(c["decks"] for c in cmds) or 1
        return [{"id": f"edhrec-{c['slug']}", "name": f"{c['name']} (deck médio)", "source": "EDHREC",
                 "archetype": c["name"], "share": round(c["decks"] / total, 4)} for c in cmds[:15]]
    return []


def opponent(data_dir, oid):
    m = re.fullmatch(r"(" + "|".join(META_FORMATS) + r")-(\d{1,10})", oid)
    if m:
        fmt, d = m.groups()
        meta_dir = os.path.join(data_dir, "meta")
        try:
            with open(os.path.join(meta_dir, "raw", f"{d}.txt")) as f:
                main, side = parse_mtgo(f.read())
        except OSError:
            return None
        arch = ""
        try:
            with open(os.path.join(meta_dir, f"{fmt}.decks.json")) as f:
                arch = next((a for a, ids in json.load(f).items() if int(d) in ids), "")
        except (OSError, ValueError):
            pass
        return {"name": arch or f"MTGTop8 {d}", "archetype": arch, "source": "MTGTop8",
                "url": f"https://www.mtgtop8.com/event?d={d}", "commanders": [], "main": main, "side": side}
    m = re.fullmatch(r"edhrec-([a-z0-9-]{1,120})", oid)
    if m:
        slug = m.group(1)
        cache_dir = os.path.join(data_dir, "edhrec")
        os.makedirs(cache_dir, exist_ok=True)

        def fetch():
            dk = get_json(f"https://json.edhrec.com/pages/average-decks/{slug}.json")["deck"]
            main = {}
            for rows in dk["cards"].values():
                for n, q in rows:
                    main[n] = main.get(n, 0) + q
            return {"name": f"{' + '.join(dk['commander'])} (deck médio)", "archetype": " + ".join(dk["commander"]),
                    "source": "EDHREC", "url": f"https://edhrec.com/average-decks/{slug}",
                    "commanders": dk["commander"], "main": main, "side": {}}
        try:
            return cached(os.path.join(cache_dir, f"avg-{slug}.json"), 7, fetch)
        except Exception:
            return None
    return None


# ---------- histórico ----------

def record(con, d):
    if not isinstance(d, dict) or d.get("winner") not in ("a", "b", "c", "d", "draw"):
        raise ValueError("Jogo inválido.")
    j = lambda v: v if isinstance(v, str) else json.dumps(v or [], ensure_ascii=False)
    cur = con.execute(
        "INSERT INTO sim_games (ts, deck_id, deck_name, format, opp_name, opp_archetype, game_no, match_id, winner,"
        " turns, a_side_in, a_side_out, summary) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (time.time(), str(d.get("deck_id") or "")[:60], str(d.get("deck_name") or "")[:200],
         str(d.get("format") or "")[:40], str(d.get("opp_name") or "")[:200], str(d.get("opp_archetype") or "")[:200],
         int(d.get("game_no") or 1), str(d.get("match_id") or "")[:60], d["winner"], int(d.get("turns") or 0),
         j(d.get("a_side_in")), j(d.get("a_side_out")), json.dumps(d.get("summary") or {}, ensure_ascii=False)))
    return cur.lastrowid


def history(con, deck_id):
    rows = con.execute("SELECT id, ts, deck_name, format, opp_name, opp_archetype, game_no, match_id, winner, turns,"
                       " a_side_in, a_side_out FROM sim_games WHERE deck_id=? ORDER BY ts", (deck_id,)).fetchall()
    cols = ["id", "ts", "deck_name", "format", "opp_name", "opp_archetype", "game_no", "match_id", "winner", "turns",
            "a_side_in", "a_side_out"]
    games = [dict(zip(cols, r)) for r in rows]
    for g in games:
        for k in ("a_side_in", "a_side_out"):
            try:
                g[k] = json.loads(g[k])
            except ValueError:
                pass
    opp = {}
    for g in games:
        o = opp.setdefault(g["opp_name"], {"opp_name": g["opp_name"], "opp_archetype": g["opp_archetype"], "games": 0,
                                           "wins": 0, "losses": 0, "draws": 0, "turns": 0, "matches": {}})
        o["games"] += 1
        o["wins"] += g["winner"] == "a"
        o["losses"] += g["winner"] not in ("a", "draw")  # com 3–4 jogadores ganha qualquer um dos outros
        o["draws"] += g["winner"] == "draw"
        o["turns"] += g["turns"]
        o["last_ts"], o["last_side_in"], o["last_side_out"] = g["ts"], g["a_side_in"], g["a_side_out"]
        if g["match_id"]:
            mt = o["matches"].setdefault(g["match_id"], [0, 0])
            mt[0] += g["winner"] == "a"
            mt[1] += g["winner"] not in ("a", "draw")
    out = []
    for o in opp.values():
        ms = o.pop("matches").values()
        o["avg_turns"] = round(o.pop("turns") / o["games"], 1)
        o["matches"], o["match_wins"] = len(ms), sum(a > b for a, b in ms)
        out.append(o)
    out.sort(key=lambda o: -o["last_ts"])
    return {"opponents": out, "recent": games[::-1][:30]}


# ---------- verificação ----------

def selfcheck():
    assert clean_sched({"parallel": 9, "quota": -1, "dist": "x"}) == {"parallel": MAX_PAR, "dist": "antigo", "quota": 0, "arena": False}
    assert clean_sched({"parallel": "4", "quota": 1, "dist": "recente", "arena": 1}) == {"parallel": 4, "dist": "recente", "quota": 1, "arena": True}
    d = {"prints": {"Island": {"id": "p1"}, "Forest": {"id": "p2"}}, "art": {"Forest": "arts/x.webp"}, "split": {"Island": [{"id": "p1", "q": 4}, {"id": "p3", "q": 4}]}}
    assert art_map(d) == {"Island": [{"id": "p1", "q": 4}, {"id": "p3", "q": 4}], "Forest": "arts/x.webp"} and art_map(None) == {}, "art_map"
    names = {fold(n): n for n in ("Fire // Ice", "Delver of Secrets", "Lightning Bolt", "Lim-Dûl's Vault", "Mountain")}
    deck = {"commanders": ["Lightning Bolt"], "main": {"Fire // Ice": 2, "Delver of Secrets // Insectile Aberration": 4,
                                                       "Lim-Dul's Vault": 1, "Carta Inventada": 1, "Mountain": 20},
            "side": {"Fire/Ice": 1}}
    txt, unk = to_dck(deck, "A", "Constructed", names)
    assert unk == ["Carta Inventada"], unk
    assert "[Main]\n2 Fire // Ice\n4 Delver of Secrets\n1 Lim-Dûl's Vault\n20 Mountain\n[Sideboard]\n1 Fire // Ice\n" in txt, txt
    assert "[Commander]" not in txt
    txt, _ = to_dck(deck, "A", "Commander", names)
    assert txt.startswith("[metadata]\nName=A\n[Commander]\n1 Lightning Bolt\n[Main]\n"), txt

    log = os.path.expanduser("~/.local/share/grimorio/forge-run/sim1.log")
    with open(log) as f:
        games = split_games(f.read())
    assert len(games) == 1
    burn = ["Goblin Guide", "Lightning Bolt", "Mountain"]
    stompy = ["Elvish Mystic", "Strangleroot Geist", "Rancor", "Aspect of Hydra", "Vines of Vastwood",
              "Leatherback Baloth", "Forest"]
    g = parse_game(*games[0], {"a": burn, "b": stompy})
    assert g["winner"] == "b" and g["turns"] == 8 and g["ms"] == 7622, (g["winner"], g["turns"], g["ms"])
    ev = g["events"]
    assert not any(e["k"] == "other" and "Phase" in e["txt"] for e in ev)
    assert ev[0] == {"t": 0, "p": "a", "k": "mulligan", "n": 7, "card": "kept",
                     "txt": "Ai(1)-Burn has kept a hand of 7 cards"}, ev[0]
    assert {"t": 1, "p": "a", "k": "land", "card": "Mountain", "id": 26, "txt": "Ai(1)-Burn played Mountain (26)"} in ev
    att = [e for e in ev if e["k"] == "attack"]
    assert att[0]["card"] == "Goblin Guide" and att[0]["target"] == "b" and att[0]["t"] == 9
    assert sum(e["k"] == "attack" and e["t"] == 16 for e in ev) == 3
    assert any(e["k"] == "block" and e["card"] == "Goblin Guide" and e["target"] == "Leatherback Baloth" for e in ev)
    rancor = next(e for e in ev if e["k"] == "cast" and e["card"] == "Rancor")
    assert rancor["p"] == "b" and rancor["target"] == "Elvish Mystic", rancor
    dmg = [e for e in ev if e["k"] == "damage"]
    assert dmg[0] == {"t": 9, "p": "a", "k": "damage", "card": "Goblin Guide", "id": 10, "n": 2, "target": "b",
                      "combat": 1, "txt": "Goblin Guide (10) deals 2 combat damage to Ai(2)-Stompy."}, dmg[0]
    # tipos novos no registo real: fases, mana -> virar, aura, +X/+X, morte por dano não registada
    assert {"t": 9, "k": "phase", "p": "a", "ph": "combat", "txt": "Ai(1)-Burn's Declare Attackers Step"} in ev
    assert {"t": 10, "k": "tap", "p": "b", "card": "Forest", "id": 107, "txt": "Forest (107) - {T}: Add {G}."} in ev
    assert any(e["k"] == "attach" and e["card"] == "Rancor" and e["tid"] == 67 for e in ev)
    assert any(e["k"] == "pump" and e["id"] == 119 and e["pt"] == "+4/+4" for e in ev)
    gg = next(e for e in ev if e["k"] == "damage" and e.get("tid") == 10)  # Baloth 4 -> Goblin Guide, que morre
    assert gg["gone"] == 1 and gg["combat"] == 1 and gg["card"] == "Leatherback Baloth", gg
    assert next(e for e in ev if e["k"] == "turn" and e["t"] == 10)["reveal"] == {"b": ["Forest", "Elvish Mystic", "Rancor"]}
    assert next(e for e in ev if e["k"] == "resolve" and e.get("card") == "Goblin Guide")["pt"] == "2/2"
    assert ev[-1]["k"] == "outcome" and ev[-1]["p"] == "b"
    s = g["summary"]
    assert s["a"]["kept"] == 7 and s["a"]["mulligans"] == 0
    assert s["b"]["damage_by_card"] == {"Elvish Mystic": 24, "Strangleroot Geist": 10}, s["b"]["damage_by_card"]
    assert s["b"]["mvp"] == "Elvish Mystic" and s["a"]["damage_by_card"] == {"Goblin Guide": 4}
    assert s["b"]["damage_to_creatures"] == {"Leatherback Baloth": 4}
    assert s["a"]["lands"] == [1] * 8 and s["a"]["lands_total"] == 8 and s["b"]["missed_land_drops"] == 0
    assert s["b"]["first_cast"]["Elvish Mystic"] == 10 and s["b"]["spells"] == 8, s["b"]
    assert len(s["life"]) == 16 and s["life"][8] == [20, 18] and s["life"][-1] == [-14, 16], s["life"]
    assert "Lightning Bolt" not in s["a"]["used"] and "Goblin Guide" in s["a"]["used"]
    # bloqueio em linha de continuação e resolução em duas linhas
    lines = ["Ai(1)-A vs Ai(2)-B - one game of Constructed", "Turn: Turn 1 (Ai(1)-A)",
             "Combat: Ai(2)-B didn't block Elvish Mystic (67).", "Ai(2)-B assigned Wall (3) to block Bear (4).",
             "Resolve Stack: Fire (49) - Fire (49) deals 2 damage divided to ", "Ai(2)-B (2 damage).",
             "Damage: Delver of Secrets (79) deals 1 combat damage to Ai(2)-B.",
             "Damage: Insectile Aberration (79) deals 3 combat damage to Ai(2)-B.",
             "Land: Ai(1)-A played Shivan Reef (5)", "Damage: Shivan Reef (5) deals 1 damage to Ai(1)-A.",
             "Engineered Explosives Did not have activator set in SpellAbilityRestriction.canPlay()",
             "Add To Stack: Ai(2)-B cast Counterspell targeting [Lightning Bolt (7)]",
             "Resolve Stack: Counterspell (8) - Counter target spell.",
             "Zone Change: Bear (4) was put into Graveyard from Battlefield."]
    g = parse_game(lines, "Game Result: Game 1 ended in a Draw! Took 99 ms.",
                   {"a": ["Fire // Ice", "Delver of Secrets // Insectile Aberration"], "b": ["Wall"]})
    assert g["winner"] == "draw" and g["ms"] == 99
    assert g["events"][1]["k"] == "block" and g["events"][1]["p"] == "b" and g["events"][1]["target"] == "Bear"
    assert g["events"][2]["card"] == "Fire // Ice" and g["events"][2]["txt"].endswith("(2 damage).")
    assert g["summary"]["a"]["damage_by_card"] == {"Delver of Secrets // Insectile Aberration": 4}
    assert g["summary"]["a"]["damage_to_creatures"] == {} and "Shivan Reef" in g["summary"]["a"]["used"]
    assert [e["k"] for e in g["events"][-3:]] == ["cast", "counter", "destroy"], g["events"][-3:]
    assert g["events"][-2]["p"] == "b" and not g["events"][-4]["txt"].endswith("canPlay()")
    # linhas reais (Affinity, Edgar, Lathril, Boros): fichas, contadores, gatilhos, transformar, mana sem dono
    lines = ["Ai(1)-A vs Ai(2)-B - one game of Commander", "Turn: Turn 7 (Ai(1)-A)",
             "Phase: Ai(1)-A's Main phase, precombat",
             "Mana: Watery Grave (108) - {T}: Add {B}.", "Add To Stack: Ai(2)-B cast Fatal Push targeting [Ajani, Nacatl Pariah (55)]",
             "Resolve Stack: Fatal Push (99) - Destroy Ajani, Nacatl Pariah (55).",
             "Add To Stack: Ai(1)-A cast Tormod's Crypt", "Add To Stack: Ai(1)-A triggered Pinnacle Emissary",
             "Resolve Stack: Whenever you cast an artifact spell, create a 1/1 colorless Drone artifact creature token with "
             "flying and \"This token can block only creatures with flying.\" [Card: Tormod's Crypt (26), Activator: Ai(1)-A]",
             "Resolve Stack: Tormod's Crypt",
             "Add To Stack: Ai(2)-B triggered Monastery Swiftspear",
             "Resolve Stack: Prowess (Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.) [Card: X]",
             "Add To Stack: Ai(2)-B triggered Yahenni, Undying Partisan",
             "Resolve Stack: Whenever a creature an opponent controls dies, put a +1/+1 counter on Yahenni, Undying Partisan. "
             "[Zone Changer: Battle Cry Goblin (17)]",
             "Resolve Stack: II — Urza's Saga gains \"{2}, {T}: Create a 0/0 colorless Construct artifact creature token.\"",
             "Add To Stack: Ai(2)-B triggered Lathril, Blade of the Elves",
             "Resolve Stack: Whenever Lathril, Blade of the Elves deals combat damage to a player, create that many 1/1 green "
             "Elf Warrior creature tokens. [Damage Source: Lathril, Blade of the Elves (201), Damaged: Ai(1)-A, Amount: 3]",
             "Resolve Stack: Wirewood Lodge (166) - Untap Elf Warrior Token (206).",
             "Resolve Stack: Ai(2)-B surveiled 1 card(s) to the graveyard",
             "Resolve Stack: Fiery Islet (54) - Ai(1)-A draws a card.",
             "Resolve Stack: Scalding Tarn (105) - Ai(2)-B searches their library for an Island or Mountain card, puts it onto "
             "the battlefield, then shuffles.",
             "Damage: Plague Stinger (56) deals 1 combat damage to Ai(2)-B(as poison counters).",
             "Damage: Ajani, Nacatl Avenger (55) deals 2 damage to Ai(2)-B.",
             "Zone Change: Send countered spell to Exile"]
    g = parse_game(lines, "", {"a": ["Ajani, Nacatl Pariah // Ajani, Nacatl Avenger", "Plague Stinger"]},
                   {"a": ["Ajani, Nacatl Pariah // Ajani, Nacatl Avenger"]})
    ev = [{k: v for k, v in e.items() if k not in ("t", "txt")} for e in g["events"]]
    assert ev[2] == {"k": "tap", "p": "b", "card": "Watery Grave", "id": 108}, ev[2]  # dono = quem lança a seguir
    assert {"k": "token", "p": "a", "card": "Drone Token", "n": 1, "pt": "1/1", "kw": ["Flying"]} in ev
    assert {"k": "resolve", "p": "a", "card": "Tormod's Crypt"} in ev  # permanente que resolve sem texto
    assert {"k": "pump", "p": "b", "card": "Monastery Swiftspear", "pt": "+1/+1"} in ev
    assert {"k": "counters", "p": "b", "card": "Yahenni, Undying Partisan", "ct": "+1/+1", "n": 1} in ev
    assert sum(e["k"] == "token" for e in ev) == 2  # o Construct citado no texto da Saga não é criado agora
    assert {"k": "token", "p": "b", "card": "Elf Warrior Token", "n": 3, "pt": "1/1"} in ev
    assert {"k": "untap", "card": "Elf Warrior Token", "id": 206} in ev
    assert {"k": "mill", "p": "b", "n": 1} in ev and {"k": "draw", "p": "a", "n": 1} in ev
    assert {"k": "search", "p": "b", "to": "battlefield"} in ev
    assert {"k": "countered", "to": "exile"} in ev
    assert {"k": "transform", "card": "Ajani, Nacatl Pariah // Ajani, Nacatl Avenger", "id": 55,
            "to": "Ajani, Nacatl Avenger"} in ev
    assert next(e for e in ev if e["k"] == "damage" and e["id"] == 55).get("bk") == 1
    psn = next(e for e in ev if e["k"] == "damage" and e["id"] == 56)
    assert psn["target"] == "b" and psn["psn"] == 1, psn
    assert g["summary"]["a"]["poison_by_card"] == {"Plague Stinger": 1}
    assert "exact" not in g
    # linhas reais do lançador GrimorioSim (Burn vs Stompy; Walking Ballista e fichas de outro jogo, ids trocados)
    lines = ["Ai(1)-Burn [Default] vs Ai(2)-Stompy [Default] - one game of Constructed",
             "GRIMORIO|Z|12|1|1|Library|Hand|0|||Goblin Guide", "GRIMORIO|Z|86|2|2|Library|Hand|0|||Llanowar Elves",
             "Mulligan: Ai(2)-Stompy has kept a hand of 7 cards", "Mulligan: Ai(1)-Burn has kept a hand of 7 cards",
             "GRIMORIO|H|1|53|12:Goblin Guide|23:Mountain|46:Rift Bolt",
             "GRIMORIO|H|2|53|86:Llanowar Elves|108:Forest|66:Elvish Mystic",
             "Turn: Turn 1 (Ai(2)-Stompy)", "Phase: Ai(2)-Stompy's Untap step", "Phase: Ai(2)-Stompy's Main phase, precombat",
             "GRIMORIO|Z|108|2|2|Hand|Battlefield|0|||Forest", "Land: Ai(2)-Stompy played Forest (108)",
             "GRIMORIO|Z|86|2|0|Hand|Stack|0|||Llanowar Elves", "GRIMORIO|T|108|1|Forest",
             "Mana: Forest (108) - {T}: Add {G}.", "Add To Stack: Ai(2)-Stompy cast Llanowar Elves",
             "GRIMORIO|Z|86|0|2|Stack|Battlefield|0|||Llanowar Elves", "Resolve Stack: Llanowar Elves - Creature 1 / 1",
             "GRIMORIO|H|1|53|12:Goblin Guide|23:Mountain|46:Rift Bolt", "GRIMORIO|H|2|53|66:Elvish Mystic",
             "Turn: Turn 2 (Ai(1)-Burn)", "Phase: Ai(1)-Burn's Untap step", "GRIMORIO|T|108|0|Forest",
             "Phase: Ai(1)-Burn's Draw step", "GRIMORIO|Z|26|1|1|Library|Hand|0|||Mountain",
             "GRIMORIO|Z|46|1|0|Hand|Stack|0|||Rift Bolt", "GRIMORIO|T|23|1|Mountain", "Mana: Mountain (23) - {T}: Add {R}.",
             "Add To Stack: Ai(1)-Burn cast Rift Bolt targeting [Llanowar Elves (86)]",
             "Damage: Rift Bolt (46) deals 3 damage to Llanowar Elves (86).",
             "Resolve Stack: Rift Bolt (46) - Rift Bolt (46) deals 3 damage to Llanowar Elves (86).",
             "GRIMORIO|Z|46|0|1|Stack|Graveyard|0|||Rift Bolt", "GRIMORIO|A|123||Rancor",
             "GRIMORIO|Z|86|2|2|Battlefield|Graveyard|0|||Llanowar Elves",
             "Zone Change: Llanowar Elves (86) was put into Graveyard from Battlefield.",
             "GRIMORIO|Z|53|1|0|Hand|Stack|0|||Walking Ballista", "Add To Stack: Ai(1)-Burn cast Walking Ballista",
             "Replacement Effect: Walking Ballista enters with X +1/+1 counters on it.",
             "GRIMORIO|C|53|+1/+1|0|1|Walking Ballista", "GRIMORIO|Z|53|0|1|Stack|Battlefield|0|||Walking Ballista",
             "Resolve Stack: Walking Ballista - Creature 0 / 0 (X=1)", "GRIMORIO|Z|199|0|1||Battlefield|1|1/1|FLYING|Soldier Token",
             "GRIMORIO|C|53|+1/+1|1|0|Walking Ballista", "GRIMORIO|Z|53|1|1|Battlefield|Graveyard|0|||Walking Ballista",
             "Zone Change: Walking Ballista (53) was put into Graveyard from Battlefield."]
    g = parse_game(lines, "Game Result: Game 1 ended in 99 ms. Ai(2)-Stompy has won!")
    assert g["exact"] and g["winner"] == "b"
    ev = [{k: v for k, v in e.items() if k != "txt"} for e in g["events"] if e["k"] != "phase"]
    assert ev[0]["k"] == "mulligan" and ev[0]["hd"] == {"a": ["Goblin Guide"], "b": ["Llanowar Elves"]}, ev[0]
    t1 = ev[2]
    assert t1["k"] == "turn" and t1["hd"]["b"] == ["Llanowar Elves", "Forest", "Elvish Mystic"] and t1["lib"] == {"a": 53, "b": 53}
    land = ev[3]  # a mudança de zona entra no evento do registo que a explica
    assert land["k"] == "land" and land["zn"] == [{"id": 108, "card": "Forest", "from": "hand", "to": "battlefield",
                                                   "fp": "b", "tp": "b"}] and land["hd"] == {"b": ["Llanowar Elves", "Elvish Mystic"]}
    assert ev[4]["k"] == "tap" and "x" not in ev[4]  # a viragem vem da linha "Mana:" (uma só vez)
    assert ev[5]["k"] == "cast" and ev[5]["zn"][0]["to"] == "stack"
    assert ev[6]["k"] == "resolve" and ev[6]["zn"][0]["to"] == "battlefield"
    t2 = next(e for e in ev if e["k"] == "turn" and e["t"] == 2)
    assert t2["ut"] == [108] and not any(e["k"] == "untap" for e in ev)
    draw = next(e for e in ev if e["k"] == "draw")
    assert draw == {"t": 2, "k": "draw", "p": "a", "card": "Mountain", "id": 26, "x": 1, "n": 1,
                    "zn": [{"id": 26, "card": "Mountain", "from": "library", "to": "hand", "fp": "a", "tp": "a"}],
                    "hd": {"a": ["Goblin Guide", "Mountain", "Rift Bolt", "Mountain"]}, "lib": {"a": 52}}, draw
    bolt = next(e for e in ev if e["k"] == "resolve" and e.get("card") == "Rift Bolt")  # o Z chega depois da resolução
    assert [z["to"] for z in bolt["zn"]] == ["graveyard"], bolt
    dead = [e for e in ev if e["k"] == "destroy"]
    assert [(e["card"], e["id"], e["x"]) for e in dead] == [("Llanowar Elves", 86, 1), ("Walking Ballista", 53, 1)], dead
    assert not any(e["k"] == "attach" or e["k"] == "other" and "was put into" in e.get("txt", "") for e in g["events"])
    wb = next(e for e in ev if e["k"] == "resolve" and e.get("card") == "Walking Ballista")
    assert wb["zn"][0]["ctr"] == {"+1/+1": 1} and "ctr" not in wb, wb  # marcadores com que entra, vindos do Forge
    tok = next(e for e in ev if e["k"] == "token")
    assert tok["card"] == "Soldier Token" and tok["id"] == 199 and tok["pt"] == "1/1" and tok["kw"] == ["Flying"], tok
    ctr = next(e for e in ev if e["k"] == "counters")
    assert ctr["n"] == -1 and ctr["abs"] == 0 and ctr["x"] == 1
    # 3 jogadores (todos contra todos): ataque a um jogador concreto, eliminações a meio (GRIMORIO|L) e lugares
    lines = ["Ai(1)-A [Default] vs Ai(2)-B [Default] vs Ai(3)-C [Reckless] - one game of Constructed",
             "GRIMORIO|H|3|53|5:Mountain", "Turn: Turn 1 (Ai(1)-A)", "Phase: Ai(1)-A's Declare Attackers Step",
             "Combat: Ai(1)-A assigned Goblin Guide (10) to attack Ai(3)-C.",
             "Damage: Goblin Guide (10) deals 2 combat damage to Ai(3)-C.", "Life: Ai(3)-C 2 > 0",
             "GRIMORIO|L|3|1|has lost because life total reached 0", "Turn: Turn 2 (Ai(2)-B)",
             "Damage: Lightning Bolt (7) deals 3 damage to Ai(2)-B.", "Life: Ai(2)-B 3 > 0",
             "GRIMORIO|L|2|2|has lost because life total reached 0", "Game Outcome: Turn 1",
             "Game Outcome: Ai(2)-B has lost because life total reached 0",
             "Game Outcome: Ai(1)-A has won because all opponents have lost",
             "Game Outcome: Ai(3)-C has lost because life total reached 0"]
    g = parse_game(lines, "Game Result: Game 1 ended in 99 ms. Ai(1)-A has won!", {"a": ["Goblin Guide", "Lightning Bolt"]})
    assert g["winner"] == "a" and g["turns"] == 2 and g["places"] == ["a", "b", "c"], (g["winner"], g["turns"], g.get("places"))
    assert g["out"] == {"c": {"t": 1, "by": "a", "why": "has lost because life total reached 0"},
                        "b": {"t": 2, "by": "a", "why": "has lost because life total reached 0"}}, g["out"]
    ev = g["events"]
    assert next(e for e in ev if e["k"] == "attack")["target"] == "c"
    assert [(e["p"], e["t"]) for e in ev if e["k"] == "outcome"] == [("c", 1), ("b", 2), ("a", 2)]
    assert sorted(g["summary"]) == ["a", "b", "c", "last_turn", "life"] and g["summary"]["life"][-1] == [20, 0, 0]
    assert g["summary"]["a"]["damage_by_card"] == {"Goblin Guide": 2, "Lightning Bolt": 3}
    # equipas: ganha a tua equipa mesmo que o Forge nomeie o parceiro
    four = {"setup": dict.fromkeys("abcd", {}), "teams": [1, 2, 1, 2], "mode": "equipas"}
    assert multi_result({"winner": "c"}, four) == {"winner": "a", "mode": "equipas", "teams": {"a": 1, "b": 2, "c": 1, "d": 2}}
    assert multi_result({"winner": "d"}, four)["winner"] == "d" and "mode" not in multi_result({"winner": "b"}, {"setup": {"a": 1, "b": 1}})
    print("selfcheck ok")


if __name__ == "__main__":
    if "--selfcheck" in sys.argv:
        selfcheck()
