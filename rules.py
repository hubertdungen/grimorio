"""Biblioteca de regras: as Comprehensive Rules oficiais (Wizards) guardadas em <data>/data/rules.txt e pesquisáveis —
glossário, keywords (702.x / 701.x), números de regra e texto. Termos comuns em português traduzem-se para os nomes
oficiais em inglês; o que não se encontrar fica para a IA (modo «regras»).
"""
import os, re, time, unicodedata, urllib.parse, urllib.request

PAGE = "https://magic.wizards.com/en/rules"
UA = {"User-Agent": "Grimorio/1.0 (uso pessoal)"}
NUM = re.compile(r"^(\d{3}\.\d+[a-z]?)\.?\s+(.*)$")
# nomes em português (das cartas impressas em PT) -> nome oficial; ponytail: lista curta das mais comuns, o resto vai pela IA
PT = {"voar": "Flying", "voo": "Flying", "atropelar": "Trample", "toque mortifero": "Deathtouch", "vinculo com a vida": "Lifelink",
      "impeto": "Haste", "vigilancia": "Vigilance", "iniciativa": "First strike", "golpe duplo": "Double strike", "alcance": "Reach",
      "resistencia a magia": "Hexproof", "indestrutivel": "Indestructible", "lampejo": "Flash", "ameacar": "Menace", "defensor": "Defender",
      "protecao": "Protection", "equipar": "Equip", "encantar": "Enchant", "vidência": "Scry", "videncia": "Scry", "triturar": "Mill",
      "reciclar": "Cycling", "recapitular": "Flashback", "reforcar": "Kicker", "destreza": "Prowess", "convocar": "Convoke",
      "cascata": "Cascade", "escavar": "Delve", "tripular": "Crew", "vigiar": "Surveil", "tesouro": "Treasure", "comida": "Food",
      "pista": "Clue", "exilar": "Exile", "sacrificar": "Sacrifice", "virar": "Tap", "desvirar": "Untap", "anular": "Counter",
      "destruir": "Destroy", "cemiterio": "Graveyard", "grimorio": "Library", "campo de batalha": "Battlefield", "comandante": "Commander",
      "manto": "Shroud", "persistir": "Persist", "imortal": "Undying", "tempestade": "Storm", "afinidade": "Affinity", "dragar": "Dredge",
      "loucura": "Madness", "metamorfose": "Morph", "evocar": "Evoke", "medo": "Fear", "intimidar": "Intimidate", "infectar": "Infect",
      "veneno": "Poison counter", "proliferar": "Proliferate", "transformar": "Transform", "explorar": "Explore", "adaptar": "Adapt",
      "mao": "Hand", "pilha": "Stack", "habilidade desencadeada": "Triggered ability", "habilidade ativada": "Activated ability",
      "fichas": "Token", "ficha": "Token", "mulligan": "Mulligan", "monarca": "Monarch", "iniciativa (masmorra)": "Initiative"}
_CACHE = {}


def norm(s):
    s = unicodedata.normalize("NFD", str(s).lower())
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9.\s]", " ", "".join(ch for ch in s if unicodedata.category(ch) != "Mn"))).strip()


def ensure(data_dir, max_age=14 * 86400):
    """O ficheiro das regras (descarrega a versão mais recente se faltar ou tiver mais de 14 dias; sem rede usa o que há)."""
    path = os.path.join(data_dir, "data", "rules.txt")
    if os.path.isfile(path) and time.time() - os.path.getmtime(path) < max_age:
        return path
    try:
        with urllib.request.urlopen(urllib.request.Request(PAGE, headers=UA), timeout=20) as r:
            m = re.search(r"https://media\.wizards\.com/[^\"']+\.txt", r.read().decode("utf-8", "replace"))
        if m:
            url = m.group(0).replace(" ", "%20")
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                body = r.read()
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path + ".tmp", "wb") as f:
                f.write(body)
            os.replace(path + ".tmp", path)
    except Exception:  # sem rede: fica a cópia antiga (se houver)
        pass
    return path if os.path.isfile(path) else None


def parse(text):
    lines = [x.strip() for x in text.replace("\r", "").split("\n")]
    gl = [i for i, x in enumerate(lines) if x == "Glossary"]
    cr = [i for i, x in enumerate(lines) if x == "Credits"]
    body_end = gl[-1] if len(gl) > 1 else len(lines)
    rules, titles = [], {}
    for x in lines[:body_end]:
        m = NUM.match(x)
        if m:
            rules.append((m.group(1), m.group(2)))
            if re.fullmatch(r"\d{3}\.\d+", m.group(1)) and len(m.group(2)) <= 40 and not m.group(2).endswith("."):
                titles[m.group(1)] = m.group(2)  # título de secção (keyword, ação…); as regras com frase não contam
    gloss, term, buf = {}, None, []
    for x in lines[body_end + 1:(cr[-1] if cr else len(lines))]:
        if not x:
            if term and buf:
                gloss[term] = " ".join(buf)
            term, buf = None, []
        elif term is None:
            term = x
        else:
            buf.append(x)
    if term and buf:
        gloss[term] = " ".join(buf)
    return {"rules": rules, "titles": titles, "gloss": gloss}


def load(data_dir):
    path = ensure(data_dir)
    if not path:
        return None
    mt = os.path.getmtime(path)
    if _CACHE.get("mt") != mt:
        with open(path, encoding="utf-8", errors="replace") as f:
            _CACHE.update(mt=mt, db=parse(f.read()))
    return _CACHE["db"]


def section(db, num, limit=40):
    """Uma secção (ex.: 702.9) com as sub-regras (702.9a, 702.9b…)."""
    return [(n, t) for n, t in db["rules"] if n == num or re.fullmatch(re.escape(num) + r"[a-z]", n)][:limit]


def search(db, q, limit=12):
    qn = norm(q)
    if not qn:
        return []
    en = PT.get(qn)
    terms = [t for t in {qn, norm(en) if en else None} if t]
    out, seen = [], set()

    def add(item):
        k = (item["kind"], item.get("num") or item.get("term"))
        if k not in seen:
            seen.add(k); out.append(item)
    m = re.fullmatch(r"(\d{3}(?:\.\d+[a-z]?)?)", qn.rstrip("."))
    if m:  # número de regra
        num = m.group(1)
        rows = [(n, t) for n, t in db["rules"] if n == num or n.startswith(num + ".") or re.fullmatch(re.escape(num) + r"[a-z]", n)]
        if rows:
            add({"kind": "rule", "num": num, "title": db["titles"].get(num, ""), "rules": rows[:40]})
    for t in terms:  # keywords e ações (títulos de secção), exatos primeiro
        for num, title in db["titles"].items():
            if norm(title) == t:
                add({"kind": "rule", "num": num, "title": title, "rules": section(db, num)})
        for term, txt in db["gloss"].items():
            if norm(term) == t or norm(term).startswith(t + " ") or norm(term).startswith(t + ","):
                add({"kind": "gloss", "term": term, "text": txt, "refs": re.findall(r"rule (\d{3}\.\d+)", txt)})
    for t in terms:  # depois o que contém o termo
        for num, title in db["titles"].items():
            if t in norm(title) and len(out) < limit:
                add({"kind": "rule", "num": num, "title": title, "rules": section(db, num, 12)})
        for term, txt in db["gloss"].items():
            if t in norm(term) and len(out) < limit:
                add({"kind": "gloss", "term": term, "text": txt, "refs": re.findall(r"rule (\d{3}\.\d+)", txt)})
    if len(out) < limit:  # por fim, regras que têm todas as palavras
        words = (norm(en) if en else qn).split()
        for n, t in db["rules"]:
            tn = norm(t)
            if all(w in tn for w in words):
                add({"kind": "hit", "num": n, "text": t})
                if len(out) >= limit:
                    break
    return out[:limit]


def route(path, data_dir):
    """GET /api/rules?q=… -> {version, results}."""
    qs = urllib.parse.parse_qs(urllib.parse.urlsplit(path).query)
    if qs.get("terms"):  # nomes em português que o browser reconhece (mecânicas a negrito abrem as regras)
        return 200, {"pt": sorted(PT)}
    q = qs.get("q", [""])[0][:120]
    db = load(data_dir)
    if not db:
        return 503, {"erro": "Ainda não tenho as regras (sem internet para as descarregar)."}
    return 200, {"translated": PT.get(norm(q)), "results": search(db, q)}


if __name__ == "__main__":  # verificação com um excerto sintético
    sample = "Glossary\n\n702. Keyword Abilities\n702.9. Flying\n702.9a Flying is an evasion ability.\n702.9b A creature with flying can't be blocked except by creatures with flying and/or reach.\n702.19. Trample\n702.19a Trample is a static ability.\n\nGlossary\n\nFlying\nA keyword ability that restricts how a creature may be blocked. See rule 702.9, “Flying.”\n\nCredits\n"
    db = parse(sample)
    assert db["titles"]["702.9"] == "Flying" and "Flying" in db["gloss"]
    r = search(db, "voar")
    assert r[0]["kind"] == "rule" and r[0]["num"] == "702.9" and len(r[0]["rules"]) == 3, r
    assert search(db, "702.9b")[0]["rules"][0][0] == "702.9b"
    assert any(x["kind"] == "gloss" for x in search(db, "Flying"))
    print("selfcheck ok")
