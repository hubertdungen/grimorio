"""Vocabulário da pesquisa: edições, universos e tipos de criatura traduzidos, a partir dos dados da Scryfall.

Lê RAW/default.jsonl.gz (todas as impressões, bulk «default_cards»), RAW/sets.json (a lista /sets da Scryfall), opcional
RAW/all.jsonl.gz (bulk «all_cards»: as impressões noutras línguas dão os nomes dos tipos em pt/es/de/zh), OUT/cards.json
(a ordem das cartas) e build/franchises.json (os universos e as palavras por que se procuram). Escreve OUT/vocab.json (+ .gz):
{"n": nº de cartas do cards.json (o browser só o usa se bater),
 "sets": [[código, nome, ano, tipo, [edições-filhas], [índices das cartas em diferenças: i0, i1-i0, …]], …] (mais recentes primeiro),
 "first": [posição em "sets" da edição onde cada carta saiu primeiro, ou -1],
 "fr": [[id, nome, [edições], [palavras], [índices das cartas com um nome do universo noutra edição]], …],
 "fl": [[índice, nome alternativo (flavor_name), edição, número, id da impressão], …] («Megatron» = Blightsteel Colossus, SLD),
 "types": {"palavra noutra língua": "Tipo"}}
As edições de promos, tokens, Art Series, Alchemy… juntam-se à edição-mãe (uma promo de LTR conta como LTR). Stdlib apenas.
"""
import collections, gzip, json, os, re, sys, unicodedata

HIDDEN = {"promo", "token", "memorabilia", "minigame", "alchemy", "vanguard", "treasure_chest"}
LANGS = {"pt", "es", "de", "zhs", "zht"}


def norm(s):
    s = unicodedata.normalize("NFD", s.lower())
    return "".join(ch for ch in s if unicodedata.category(ch) != "Mn").strip(" ,.;:()")


def wnorm(s):
    """Como o norm() de web/src/vocab.js: sem acentos nem apóstrofos, & = and, o resto separa palavras."""
    s = norm(s).replace("&", " and ")
    s = re.sub(r"['’`´]", "", s)
    return " ".join(re.sub(r"[^a-z0-9㐀-鿿]+", " ", s).split())


def subtypes(line, zh=False):
    """As palavras depois do travessão de uma face («Creature — Elf Druid» → [Elf, Druid]; zh: 生物～精灵／德鲁伊)."""
    for sep in ("—", "～", "~", " - "):
        if sep in line:
            rest = line.split(sep, 1)[1]
            return [w for w in rest.replace("／", " ").replace("/", " ").split() if w] if zh else rest.split()
    return []


def type_words(path, ctypes):
    """{palavra estrangeira: tipo inglês} pelas impressões traduzidas: um tipo sozinho dá o par direto; com vários, o par
    que aparece junto mais vezes (Dice), porque o espanhol e o português trocam a ordem («Bribón humano» = Human Rogue)."""
    one = {l: collections.Counter() for l in LANGS}
    pair = {l: collections.Counter() for l in LANGS}
    ne = {l: collections.Counter() for l in LANGS}
    nf = {l: collections.Counter() for l in LANGS}
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        for line in fh:
            if '"lang":"en"' in line[:400] or '"printed_type_line"' not in line:
                continue
            c = json.loads(line)
            lang = c.get("lang")
            if lang not in LANGS:
                continue
            en, fo = c.get("type_line", ""), c.get("printed_type_line", "")
            for ef, ff in zip(en.split(" // "), fo.split(" // ")):
                if not ("Creature" in ef or "Kindred" in ef or "Tribal" in ef):
                    continue
                E = [w for w in subtypes(ef) if w in ctypes]
                F = [norm(w) for w in subtypes(ff, lang.startswith("zh"))]
                F = [w for w in F if w]
                if not E or not F:
                    continue
                if len(E) == 1 and len(F) == 1:
                    one[lang][(E[0], F[0])] += 1
                for e in set(E):
                    ne[lang][e] += 1
                    for f in set(F):
                        pair[lang][(e, f)] += 1
                for f in set(F):
                    nf[lang][f] += 1
    out, score = {}, {}
    for lang in LANGS:
        best = {}
        for (e, f), n in one[lang].items():
            if n >= 2 and n > best.get(e, ("", 0))[1]:
                best[e] = (f, n)
        dice = {}
        for (e, f), n in pair[lang].items():
            d = 2 * n / (ne[lang][e] + nf[lang][f])
            if e not in best and n >= 3 and d >= 0.5 and d > dice.get(e, ("", 0, 0))[2]:
                dice[e] = (f, n, d)
        best.update({e: x[:2] for e, x in dice.items()})
        for e, (f, n) in best.items():
            if f == e.lower() or (len(f) < 3 and not lang.startswith("zh")) or f in out and score[f] >= n:
                continue
            out[f], score[f] = e, n
    lower = {t.lower() for t in ctypes}
    return {f: e for f, e in sorted(out.items()) if f not in lower or f == e.lower()}


def main(raw, out_dir, src):
    with open(os.path.join(out_dir, "cards.json"), encoding="utf-8") as f:
        cards = json.load(f)
    idx = {c["n"]: i for i, c in enumerate(cards)}
    ctypes = {w for c in cards for face in c["t"].split(" // ") if "—" in face and ("Creature" in face or "Kindred" in face)
              for w in face.split("—")[1].split()}
    with open(os.path.join(raw, "sets.json"), encoding="utf-8") as f:
        S = {s["code"]: s for s in json.load(f)["data"]}
    with open(os.path.join(src, "franchises.json"), encoding="utf-8") as f:
        fr = json.load(f)["franchises"]

    def shown(s):
        return not s.get("digital") and s["set_type"] not in HIDDEN and not (s["set_type"] == "masterpiece" and s.get("parent_set_code"))

    def fold(code):
        seen = set()
        while code in S and code not in seen:
            seen.add(code)
            if shown(S[code]):
                return code
            code = S[code].get("parent_set_code")
        return None

    mem, first, flavor = collections.defaultdict(set), {}, []
    with gzip.open(os.path.join(raw, "default.jsonl.gz"), "rt", encoding="utf-8") as fh:
        for line in fh:
            c = json.loads(line)
            n = c.get("name", "")
            i = idx.get(n, idx.get(n.split(" // ")[0]) if len(set(n.split(" // "))) == 1 else None)  # reversible: «X // X»
            if i is None or c.get("digital"):
                continue
            # nomes de outro universo na mesma carta (Secret Lair «Megatron» = Blightsteel Colossus, Godzilla em IKO)
            fl = c.get("flavor_name") or " // ".join(dict.fromkeys(f["flavor_name"] for f in c.get("card_faces") or [] if f.get("flavor_name")))
            if fl and c.get("lang") == "en" and not any(x[0] == i and x[1] == fl for x in flavor):
                flavor.append([i, fl, c["set"], c.get("collector_number", ""), c["id"]])
            k = fold(c.get("set"))
            if not k:
                continue
            mem[k].add(i)
            key = (c.get("released_at") or "9999", S[k].get("parent_set_code") is not None, k)
            if i not in first or key < first[i]:
                first[i] = key
    # edições-filhas (Commander, Eternal…); um universo não entra na edição-mãe (BOT não é cartas de BRO, REX não é LCI)
    in_fr = {s: {f["id"] for f in fr if s in f["sets"]} for f in fr for s in f["sets"]}
    kids = collections.defaultdict(list)
    for k in mem:
        p = fold(S[k].get("parent_set_code")) if S[k].get("parent_set_code") else None
        if p and p != k and p in mem and (k not in in_fr or in_fr[k] & in_fr.get(p, set())):
            kids[p].append(k)
    order = sorted(mem, key=lambda k: (S[k].get("released_at") or "", k), reverse=True)
    pos = {k: n for n, k in enumerate(order)}
    sets = []
    for k in order:
        ids, prev, d = sorted(mem[k]), 0, []
        for i in ids:
            d.append(i - prev)
            prev = i
        s = S[k]
        sets.append([k, s["name"], (s.get("released_at") or "")[:4], s["set_type"], sorted(kids[k], key=pos.get), d])
    franchises = []
    for f in fr:
        got, todo = [], [s for s in f["sets"] if s in mem]
        while todo:
            s = todo.pop(0)
            if s not in got:
                got.append(s)
                todo += kids[s]
        # cartas com um nome do universo noutra edição: a impressão é de uma edição do universo, de uma das «flavor»
        # (Godzilla: IKO e as promos) ou o nome tem uma das palavras («Megatron» na Secret Lair → Transformers)
        words = [f" {wnorm(a)} " for a in f["alias"] if len(wnorm(a)) >= 4]
        extra = sorted({x[0] for x in flavor if fold(x[2]) in got or x[2] in f.get("flavor", ())
                        or any(w in f" {wnorm(x[1])} " for w in words)})
        if got or extra:
            franchises.append([f["id"], f["name"], got, f["alias"], extra])
        else:
            print(f"vocab: universo sem cartas: {f['id']}", flush=True)
    all_path = os.path.join(raw, "all.jsonl.gz")
    try:  # sem o all_cards (ou estragado): ficam só as tabelas fixas do nlsearch.js
        types = type_words(all_path, ctypes) if os.path.isfile(all_path) else {}
    except (OSError, EOFError, ValueError) as e:
        print(f"vocab: tipos traduzidos de fora ({e!r})", flush=True)
        types = {}
    out = {"n": len(cards), "sets": sets, "first": [pos[first[i][2]] if i in first else -1 for i in range(len(cards))],
           "fr": franchises, "fl": sorted(flavor), "types": types}
    p = os.path.join(out_dir, "vocab.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
    with open(p, "rb") as a, gzip.open(p + ".gz", "wb", compresslevel=9) as b:
        b.write(a.read())
    print(f"vocab: {len(sets)} edições, {len(franchises)} universos, {len(types)} nomes de tipos traduzidos, "
          f"{sum(1 for i in range(len(cards)) if i not in first)} cartas sem edição")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], os.path.dirname(os.path.abspath(__file__)))
