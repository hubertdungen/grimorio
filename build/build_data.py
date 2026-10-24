"""Gera os dados do Grimório a partir da Scryfall e do Commander Spellbook.

Corre dentro de python:3.12-slim (ver build.sh), porque o host não tem numpy.
Entradas: RAW/oracle.jsonl.gz, RAW/variants.json.gz
Saídas em OUT/: cards.json, emb.bin (int8 N×D), pos.bin (float32 N×3), combos.json, meta.json
"""
import gzip, json, re, sys, time, os
import numpy as np

RAW, OUT = sys.argv[1], sys.argv[2]
DIM = 128

# Ordem fixa: o índice é o bit no campo "lg" (legal) e "rs" (restrita) de cada carta.
FORMATS = ["standard", "pioneer", "modern", "legacy", "vintage", "pauper", "commander",
           "oathbreaker", "brawl", "standardbrawl", "historic", "timeless", "alchemy",
           "penny", "premodern", "oldschool", "predh", "paupercommander", "duel", "gladiator"]
SKIP_LAYOUTS = {"token", "double_faced_token", "emblem", "art_series", "vanguard",
                "planar", "scheme", "augment", "host", "reversible_card"}

# Etiquetas automáticas por expressões regulares ao texto (com o nome trocado por "~").
TAGS = {
    "ramp": r"add \{|add (one|two|three) mana|search your library for (a|up to \w+) (basic )?land|land cards?[^.]*onto the battlefield|create (a|\w+) treasure",
    "draw": r"draws? (a|an|one|two|three|four|x|that many|cards equal)[^.]*cards?|investigate|connive",
    "removal": r"(destroy|exile) target (?!card)[^.]*(creature|artifact|enchantment|planeswalker|permanent|nonland)|deals? (\d+|x) damage to (any target|target creature|target planeswalker)|target creature gets -\d|return target (nonland )?(creature|permanent)[^.]*to its owner's hand|fights? target",
    "wipe": r"(destroy|exile) all|each creature gets -|damage to each creature|return all (nonland )?(creatures|permanents)",
    "counter": r"counter target",
    "tutor": r"search your library for (a|an|up to)(?! basic land)(?! land)(?![^.]*basic)",
    "recursion": r"return[^.]*from (your|a) graveyard|cast[^.]*from your graveyard",
    "protection": r"(gains?|have) (hexproof|indestructible|shroud|protection)|phase out",
    "tokens": r"create[^.]*tokens?",
    "sacrifice": r"sacrifice (a|another|an|x|two)",
    "counters": r"\+1/\+1 counter|proliferate",
    "lifegain": r"gain[s]? (\d+|x|that much) life|lifelink",
    "graveyard": r"mill|from your graveyard|in your graveyard|surveil",
    "etb": r"enters( the battlefield)?,|whenever[^.]*enters",
    "spellslinger": r"instant (or|and) sorcery|whenever you cast[^.]*(instant|noncreature)",
    "artifacts": r"artifacts? you control|whenever[^.]*artifact",
    "enchantments": r"enchantments? you control|constellation|whenever[^.]*enchantment",
    "discard": r"discards?|each opponent discards",
    "evasion": r"flying|trample|menace|can't be blocked|unblockable",
}
TAG_RE = {k: re.compile(v) for k, v in TAGS.items()}


def card_text(c):
    if "card_faces" in c and not c.get("oracle_text"):
        return "\n//\n".join(f.get("oracle_text", "") for f in c["card_faces"])
    return c.get("oracle_text", "")


def mana_cost(c):
    if c.get("mana_cost") is not None and c.get("mana_cost") != "":
        return c["mana_cost"]
    return " // ".join(f.get("mana_cost", "") for f in c.get("card_faces", []) if f.get("mana_cost"))


cards, texts = [], []
with gzip.open(os.path.join(RAW, "oracle.jsonl.gz"), "rt") as fh:
    for line in fh:
        c = json.loads(line)
        if c.get("layout") in SKIP_LAYOUTS:
            continue
        lg = c.get("legalities", {})
        legal = sum(1 << i for i, f in enumerate(FORMATS) if lg.get(f) in ("legal", "restricted"))
        restr = sum(1 << i for i, f in enumerate(FORMATS) if lg.get(f) == "restricted")
        if not legal and c.get("set_type") != "funny":
            continue  # cartas que não existem em formato nenhum (cartas-oversized, testes, etc.)
        text = card_text(c)
        name = c["name"]
        low = text.lower()
        for part in [name] + name.split(" // "):
            low = low.replace(part.lower(), "~")
        short = name.split(",")[0].lower()
        if len(short) > 3:
            low = low.replace(short, "~")
        tags = [k for k, r in TAG_RE.items() if r.search(low)]
        tl = c.get("type_line", "")
        if "Land" in tl.split("—")[0]:
            tags = [t for t in tags if t != "ramp"] + ["land"]
        dfc = "card_faces" in c and "image_uris" not in c
        prices = c.get("prices") or {}
        cards.append({
            "n": name, "id": c["id"], "mc": mana_cost(c), "cmc": c.get("cmc", 0), "t": tl,
            "o": text, "ci": "".join(c.get("color_identity", [])), "co": "".join(c.get("colors") or []),
            "r": (c.get("rarity") or "c")[0], "lg": legal, "rs": restr,
            "eur": float(prices["eur"]) if prices.get("eur") else None,
            "usd": float(prices["usd"]) if prices.get("usd") else None,
            "er": c.get("edhrec_rank"), "gc": 1 if c.get("game_changer") else 0,
            "pt": f'{c["power"]}/{c["toughness"]}' if "power" in c else (c.get("loyalty") or ""),
            "tg": tags, "df": 1 if dfc else 0, "kw": c.get("keywords", []),
            "y": (c.get("released_at") or "")[:4], "un": 1 if not legal else 0,
        })
        texts.append(f"{tl}. {low} {' '.join(c.get('keywords', []))}".strip())

print(f"{len(cards)} cartas", flush=True)

# --- Embeddings do texto (modelo local, gratuito) ---
t0 = time.time()
from fastembed import TextEmbedding
model = TextEmbedding("BAAI/bge-small-en-v1.5", cache_dir="/cache", threads=4)
emb = np.array(list(model.embed(texts, batch_size=64)), dtype=np.float32)
print(f"embeddings {emb.shape} em {time.time()-t0:.0f}s", flush=True)

# PCA para DIM dimensões: o browser faz as contas de semelhança, 128 int8 cabe em ~5 MB.
emb -= emb.mean(0)
_, _, vt = np.linalg.svd(emb[np.random.default_rng(0).choice(len(emb), min(8000, len(emb)), replace=False)], full_matrices=False)
red = emb @ vt[:DIM].T
red /= np.linalg.norm(red, axis=1, keepdims=True) + 1e-9
q = np.clip(np.round(red * 127), -127, 127).astype(np.int8)
q.tofile(os.path.join(OUT, "emb.bin"))

# --- Mapa 3D ---
t0 = time.time()
import umap
pos = umap.UMAP(n_components=3, n_neighbors=20, min_dist=0.15, metric="cosine",
                random_state=42, low_memory=True).fit_transform(red)
pos = (pos - pos.mean(0)) / np.abs(pos - pos.mean(0)).max() * 100
pos.astype(np.float32).tofile(os.path.join(OUT, "pos.bin"))
print(f"umap em {time.time()-t0:.0f}s", flush=True)

# --- Combos (leitura em fluxo: o JSON descomprimido tem ~700 MB) ---
import ijson
by_name = {c["n"]: i for i, c in enumerate(cards)}
for i, c in enumerate(cards):
    for part in c["n"].split(" // "):
        by_name.setdefault(part, i)
CB_FORMATS = {"standard": "standard", "pioneer": "pioneer", "modern": "modern", "legacy": "legacy",
              "vintage": "vintage", "pauper": "pauper", "commander": "commander",
              "oathbreaker": "oathbreaker", "brawl": "brawl", "standardBrawl": "standardbrawl",
              "premodern": "premodern", "predh": "predh", "pauperCommander": "paupercommander"}
combos = []
with gzip.open(os.path.join(RAW, "variants.json.gz"), "rb") as fh:
    for v in ijson.items(fh, "variants.item"):
        if v.get("status") != "OK" or v.get("spoiler"):
            continue
        idx = [by_name.get(u["card"]["name"]) for u in v["uses"]]
        if None in idx or len(idx) > 5:
            continue
        lg = v.get("legalities") or {}
        legal = sum(1 << FORMATS.index(f) for k, f in CB_FORMATS.items() if lg.get(k))
        combos.append([
            v["id"], idx,
            [p["feature"]["name"] for p in v.get("produces", [])][:4],
            [(r.get("template") or {}).get("name") for r in v.get("requires", []) if (r.get("template") or {}).get("name")][:3],
            legal, v.get("popularity") or 0, v.get("bracketTag") or "",
        ])
print(f"{len(combos)} combos", flush=True)

with open(os.path.join(OUT, "cards.json"), "w") as f:
    json.dump(cards, f, separators=(",", ":"), ensure_ascii=False)
with open(os.path.join(OUT, "combos.json"), "w") as f:
    json.dump(combos, f, separators=(",", ":"), ensure_ascii=False)
with open(os.path.join(OUT, "meta.json"), "w") as f:
    json.dump({"built": time.strftime("%Y-%m-%dT%H:%M:%S"), "cards": len(cards), "combos": len(combos),
               "dim": DIM, "formats": FORMATS, "tags": list(TAGS)}, f)
for name in ("cards.json", "combos.json", "emb.bin", "pos.bin", "meta.json"):
    p = os.path.join(OUT, name)
    with open(p, "rb") as a, gzip.open(p + ".gz", "wb", compresslevel=9) as b:
        b.write(a.read())
print("feito", flush=True)
