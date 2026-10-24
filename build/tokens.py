"""Índice de tokens reais (Scryfall) para o tabuleiro: imagem certa de cada ficha criada.

Lê RAW/oracle.jsonl.gz (o mesmo do build_data.py) e escreve OUT/tokens.json (+ .gz):
{"tokens": {id: [nome, p/t, cores, tipo]}, "byCard": {nome da carta: [ids dos tokens que cria]},
 "byName": {nome do token: [ids]}}
Stdlib apenas; corre em segundos (não precisa do contentor).
"""
import gzip, json, os, sys

RAW, OUT = sys.argv[1], sys.argv[2]
tokens, by_card, by_name, parts_name = {}, {}, {}, {}
with gzip.open(os.path.join(RAW, "oracle.jsonl.gz"), "rt") as fh:
    for line in fh:
        c = json.loads(line)
        if c.get("layout") in ("token", "double_faced_token") or "Token" in c.get("type_line", ""):
            if c.get("layout") == "emblem":
                continue
            pt = f'{c["power"]}/{c["toughness"]}' if "power" in c else ""
            tokens[c["id"]] = [c["name"], pt, "".join(c.get("colors") or []), c.get("type_line", "")]
            by_name.setdefault(c["name"].lower(), []).append(c["id"])
        for part in c.get("all_parts") or []:
            if part.get("component") == "token" and part.get("id") != c["id"]:
                by_card.setdefault(c["name"], []).append(part["id"])
                parts_name[part["id"]] = part.get("name", "")
# os ids de all_parts apontam para impressões; garante que existem no índice (senão, fica só o nome)
missing = {i for ids in by_card.values() for i in ids if i not in tokens}
# impressões de tokens que não estão no oracle: a imagem funciona pelo id; nome do all_parts, P/T e cores do token homónimo
for i in missing:
    n = parts_name.get(i, "")
    twin = tokens.get((by_name.get(n.lower()) or [None])[0]) or [n, "", "", ""]
    tokens[i] = [n, twin[1], twin[2], twin[3]]
out = {"tokens": tokens, "byCard": by_card, "byName": by_name, "missing": len(missing)}
os.makedirs(OUT, exist_ok=True)
p = os.path.join(OUT, "tokens.json")
with open(p, "w") as f:
    json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
with open(p, "rb") as a, gzip.open(p + ".gz", "wb", compresslevel=9) as b:
    b.write(a.read())
print(f"{len(tokens)} tokens, {len(by_card)} cartas que criam tokens, {len(missing)} ids sem token no oracle")
