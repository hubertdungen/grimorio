"""Índice de tokens reais (Scryfall) para o tabuleiro: imagem certa de cada ficha criada.

Lê RAW/oracle.jsonl.gz (o mesmo do build_data.py) e escreve OUT/tokens.json (+ .gz):
{"tokens": {id: [nome, p/t, cores, tipo, texto, palavras-chave, faces, edição, layout]}, "byCard": {nome da carta: [ids dos
 tokens que cria]}, "byName": {nome do token: [ids]}}
cores em ordem WUBRG; p/t de um planeswalker = a lealdade (como no cards.json); faces só nas fichas de duas faces:
[[nome, p/t, cores], …] (a escolha no browser vê a face com o nome pedido); edição = a do token («tm13»), para preferir a
impressão da edição da carta que o criou; layout «flip» = papéis (Roles) com as duas faces na mesma imagem (sem verso).
Tokens, emblemas e masmorras. As impressões que o all_parts aponta e o oracle não traz (outra edição do mesmo token) vêm
da Scryfall por /cards/collection (75 de cada vez, com pausa) e ficam em RAW/tokprints.json; sem rede, o nome e o tipo
do all_parts escolhem o token homónimo mais parecido. Stdlib apenas.
"""
import gzip, json, os, sys, time, urllib.request

WUBRG = "WUBRG"
cols = lambda cs: "".join(k for k in WUBRG if k in (cs or []))
pt_of = lambda c: f'{c["power"]}/{c["toughness"]}' if "power" in c else c.get("loyalty", "")


def entry(c):
    fs = c.get("card_faces") or []
    if fs:  # duas faces (double_faced_token, reversible_card…): P/R, cores e texto estão nas faces
        faces = [[f["name"], pt_of(f), cols(f.get("colors"))] for f in fs]
        return [c["name"], faces[0][1], cols({k for f in fs for k in f.get("colors") or []}), c.get("type_line", ""),
                "\n//\n".join(f.get("oracle_text", "") for f in fs), c.get("keywords") or [], faces, c.get("set", ""),
                "flip" if c.get("layout") == "flip" else ""]
    return [c["name"], pt_of(c), cols(c.get("colors")), c.get("type_line", ""), c.get("oracle_text", ""), c.get("keywords") or [], 0,
            c.get("set", ""), ""]


def fetch_prints(ids, cache_file):
    """As impressões de tokens que o oracle não traz, pela Scryfall (guardadas: um id de impressão não muda)."""
    try:
        with open(cache_file) as f:
            got = json.load(f)
    except (OSError, ValueError):
        got = {}
    todo = [i for i in sorted(ids) if i not in got]
    for k in range(0, len(todo), 75):
        body = json.dumps({"identifiers": [{"id": i} for i in todo[k:k + 75]]}).encode()
        req = urllib.request.Request("https://api.scryfall.com/cards/collection", data=body, headers={
            "Content-Type": "application/json", "Accept": "application/json",
            "User-Agent": "Grimorio/1.0 (+https://github.com/hubertdungen/grimorio)"})
        try:
            for c in json.load(urllib.request.urlopen(req, timeout=60)).get("data", []):
                got[c["id"]] = entry(c)
        except Exception as e:  # sem rede: fica o que já havia
            print(f"tokens: Scryfall indisponível ({e!r}); impressões em falta pelo nome", flush=True)
            break
        time.sleep(0.15)  # as regras da Scryfall: 50–100 ms entre pedidos
    try:
        with open(cache_file, "w") as f:
            json.dump(got, f, separators=(",", ":"))
    except OSError:
        pass
    return got


def main(raw, out_dir):
    tokens, by_card, by_name, parts_name = {}, {}, {}, {}
    with gzip.open(os.path.join(raw, "oracle.jsonl.gz"), "rt") as fh:
        for line in fh:
            c = json.loads(line)
            # masmorras (venture/iniciativa: as salas na zona de comando) também, para terem imagem
            # e emblemas («Gideon of the Trials Emblem»: a zona de comando com a imagem do emblema)
            if c.get("layout") in ("token", "double_faced_token", "emblem") or "Token" in c.get("type_line", "") or c.get("type_line", "").split(" — ")[0] == "Dungeon":
                tokens[c["id"]] = entry(c)
                by_name.setdefault(c["name"].lower(), []).append(c["id"])
                if " // " in c["name"]:  # ficha de duas faces («Undercity // The Initiative»): também por cada face
                    for f in c["name"].split(" // "):
                        if c["id"] not in by_name.setdefault(f.lower(), []):
                            by_name[f.lower()].append(c["id"])
            for part in c.get("all_parts") or []:
                if part.get("component") == "token" and part.get("id") != c["id"]:
                    by_card.setdefault(c["name"], []).append(part["id"])
                    parts_name[part["id"]] = (part.get("name", ""), part.get("type_line", ""))
    # os ids de all_parts apontam para impressões; garante que existem no índice (senão, fica só o nome)
    missing = {i for ids in by_card.values() for i in ids if i not in tokens}
    got = fetch_prints(missing, os.path.join(raw, "tokprints.json")) if missing and not os.environ.get("GRIMORIO_OFFLINE") else {}
    for i in missing:
        if i in got:  # também pelo nome: entre impressões iguais, o browser escolhe a da edição da carta (o Forge diz qual)
            tokens[i] = got[i]
            for f in [got[i][0]] + (got[i][0].split(" // ") if " // " in got[i][0] else []):
                by_name.setdefault(f.lower(), []).append(i)
            continue
        # sem rede: a imagem funciona pelo id; o nome do all_parts e o resto do token homónimo com o mesmo tipo
        n, tl = parts_name.get(i, ("", ""))
        twins = [tokens[x] for x in by_name.get(n.lower(), []) if x in tokens]
        twin = next((x for x in twins if x[3] == tl), twins[0] if twins else [n, "", "", tl, "", [], 0, "", ""])
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
