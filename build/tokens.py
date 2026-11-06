"""Índice de tokens reais (Scryfall) para o tabuleiro: imagem certa de cada ficha criada.

Lê RAW/oracle.jsonl.gz (o mesmo do build_data.py) e escreve OUT/tokens.json (+ .gz):
{"tokens": {id: [nome, p/t, cores, tipo, texto, palavras-chave, faces]}, "byCard": {nome da carta: [ids dos tokens que cria]},
 "byName": {nome do token: [ids]}}
cores em ordem WUBRG; p/t de um planeswalker = a lealdade (como no cards.json); faces só nas fichas de duas faces:
[[nome, p/t, cores], …] (a escolha no browser vê a face com o nome pedido). Stdlib apenas; corre em segundos.
"""
import gzip, json, os, sys

WUBRG = "WUBRG"
cols = lambda cs: "".join(k for k in WUBRG if k in (cs or []))
pt_of = lambda c: f'{c["power"]}/{c["toughness"]}' if "power" in c else c.get("loyalty", "")


def entry(c):
    fs = c.get("card_faces") or []
    if fs:  # duas faces (double_faced_token, reversible_card…): P/R, cores e texto estão nas faces
        faces = [[f["name"], pt_of(f), cols(f.get("colors"))] for f in fs]
        return [c["name"], faces[0][1], cols({k for f in fs for k in f.get("colors") or []}), c.get("type_line", ""),
                "\n//\n".join(f.get("oracle_text", "") for f in fs), c.get("keywords") or [], faces]
    return [c["name"], pt_of(c), cols(c.get("colors")), c.get("type_line", ""), c.get("oracle_text", ""), c.get("keywords") or [], 0]


def main(raw, out_dir):
    tokens, by_card, by_name, parts_name = {}, {}, {}, {}
    with gzip.open(os.path.join(raw, "oracle.jsonl.gz"), "rt") as fh:
        for line in fh:
            c = json.loads(line)
            # masmorras (venture/iniciativa: as salas na zona de comando) também, para terem imagem
            if c.get("layout") in ("token", "double_faced_token") or "Token" in c.get("type_line", "") or c.get("type_line", "").split(" — ")[0] == "Dungeon":
                if c.get("layout") == "emblem":
                    continue
                tokens[c["id"]] = entry(c)
                by_name.setdefault(c["name"].lower(), []).append(c["id"])
                if " // " in c["name"]:  # ficha de duas faces («Undercity // The Initiative»): também por cada face
                    for f in c["name"].split(" // "):
                        if c["id"] not in by_name.setdefault(f.lower(), []):
                            by_name[f.lower()].append(c["id"])
            for part in c.get("all_parts") or []:
                if part.get("component") == "token" and part.get("id") != c["id"]:
                    by_card.setdefault(c["name"], []).append(part["id"])
                    parts_name[part["id"]] = part.get("name", "")
    # os ids de all_parts apontam para impressões; garante que existem no índice (senão, fica só o nome)
    missing = {i for ids in by_card.values() for i in ids if i not in tokens}
    # impressões de tokens que não estão no oracle: a imagem funciona pelo id; nome do all_parts, o resto do token homónimo
    for i in missing:
        n = parts_name.get(i, "")
        twin = tokens.get((by_name.get(n.lower()) or [None])[0]) or [n, "", "", "", "", [], 0]
        tokens[i] = [n] + twin[1:]
    out = {"tokens": tokens, "byCard": by_card, "byName": by_name, "missing": len(missing)}
    os.makedirs(out_dir, exist_ok=True)
    p = os.path.join(out_dir, "tokens.json")
    with open(p, "w") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
    with open(p, "rb") as a, gzip.open(p + ".gz", "wb", compresslevel=9) as b:
        b.write(a.read())
    print(f"{len(tokens)} tokens, {len(by_card)} cartas que criam tokens, {len(missing)} ids sem token no oracle")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
