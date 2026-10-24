#!/usr/bin/env python3
"""Metagame de formatos construídos a partir do MTGTop8 (só biblioteca padrão).

Para cada formato: lê a página do formato no período "Last 2 Months", reparte
--max-decks pelos arquétipos em proporção à quota de cada um, recolhe as listas
mais recentes de cada arquétipo e calcula estatísticas por carta.

Fontes (www.mtgtop8.com):
  format?f=MO                 -> ids dos períodos (meta=...), por etiqueta
  format?f=MO&meta=51         -> arquétipos: archetype?a=ID&meta=51&f=MO + "N %"
  archetype?a=ID&meta=51&f=MO -> 20 listas por página (deck_ref, nome, data dd/mm/yy);
                                 página N por POST current_page=N
  compare?l=_d1_d2_..._       -> até 20 listas numa tabela (principal + SIDEBOARDS)
  mtgo?d=ID                   -> exportação MTGO de uma lista (recurso se o compare falhar)

Cache: meta/raw/<deckid>.txt em formato MTGO ("4 Nome" ... "Sideboard" ...). As
listas nunca mudam; as páginas de formato/arquétipo são sempre pedidas de novo.

Saída: meta/<formato>.json e .json.gz (escrita atómica), e meta/<formato>.decks.json =
{arquétipo: [ids das listas em raw/, mais recentes primeiro]} para os adversários do sim.py
{
  "format", "source": "mtgtop8", "built", "since" (data ISO mais antiga), "decks",
  "archetypes": [{"name", "decks", "share", "core": [[carta, inclusão, cópias médias], ...]}],
  "cards": [[carta, incl_main, cópias_main, incl_side, cópias_side, [índices de arquétipos com incl>=0.5]]],
  "pairs": {carta: [[parceira, lift, P(parceira|carta)], ...]}
}
Uso: python3 meta_mtgtop8.py [--formats modern,pioneer] [--max-decks 400] [--selfcheck]
"""
import argparse, gzip, html, json, os, re, sys, time, unicodedata
import urllib.error, urllib.parse, urllib.request
from collections import Counter, defaultdict
from datetime import datetime

FORMATS = {"standard": "ST", "pioneer": "PI", "modern": "MO", "legacy": "LE",
           "vintage": "VI", "pauper": "PAU", "premodern": "PREM"}
PERIOD = "Last 2 Months"
BASE = "https://www.mtgtop8.com/"
UA = "Mozilla/5.0 (compatible; Grimorio/1.0; uso pessoal)"
DATA = os.environ.get("GRIMORIO_DATA_DIR", os.path.expanduser("~/.local/share/grimorio"))
OUT = os.path.join(DATA, "meta")
RAW = os.path.join(OUT, "raw")
ORACLE = os.path.join(DATA, "raw", "oracle.jsonl.gz")
BASICS = {"Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"} | \
         {"Snow-Covered " + b for b in ("Plains", "Island", "Swamp", "Mountain", "Forest")}
CORE_N, PAIR_MIN_INCL, PAIR_MIN_CO, PAIR_TOP = 30, 0.03, 5, 12

_last = 0.0


def fetch(path, data=None, tries=3):
    """Um pedido de cada vez, >= 1 s entre pedidos, com repetições e espera crescente."""
    global _last
    body = urllib.parse.urlencode(data).encode() if data else None
    for i in range(tries):
        time.sleep(max(0.0, _last + 1.0 - time.time()))
        _last = time.time()
        try:
            req = urllib.request.Request(BASE + path, data=body, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                cs = r.headers.get_content_charset() or "latin-1"
                return r.read().decode(cs, "replace")
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            if i == tries - 1:
                raise
            print(f"    ! {path}: {e}; nova tentativa", flush=True)
            time.sleep(3 * (i + 1) ** 2)
        finally:
            _last = time.time()


# ---------- análise do HTML / texto ----------

def parse_periods(page, code):
    return {html.unescape(lbl): int(m) for m, lbl in
            re.findall(r'\?f=' + re.escape(code) + r'&meta=(\d+)&a="><div[^>]*>([^<]+)</div>', page)}


def parse_archetypes(page, code, meta):
    pat = (r'archetype\?a=(\d+)&meta=' + str(meta) + '&f=' + re.escape(code) +
           r'>([^<]*)</a></div>\s*<div>\s*<div[^>]*>([\d.]+) %')
    return [(int(a), html.unescape(n).strip(), float(p)) for a, n, p in re.findall(pat, page)]


def parse_archetype_page(page):
    """[(deck_id, 'AAAA-MM-DD')] pela ordem da página (mais recentes primeiro)."""
    out = []
    for row in re.findall(r'<tr class=hover_tr>(.*?)</tr>', page, re.S):
        d = re.search(r'deck_ref\[\d+\] value=(\d+)', row)
        dt = re.search(r'<td>(\d\d)/(\d\d)/(\d\d)</td>', row)
        if d and dt:
            out.append((int(d.group(1)), f"20{dt.group(3)}-{dt.group(2)}-{dt.group(1)}"))
    return out


def parse_compare(page, ids):
    """Tabela do compare -> {deck_id: texto MTGO}. Colunas pela ordem de `ids`."""
    main_html, _, side_html = page.partition(">SIDEBOARDS<")
    if not side_html:
        raise ValueError("compare sem secção SIDEBOARDS")
    decks = {i: ([], []) for i in ids}
    for part, html_part in ((0, main_html), (1, side_html)):
        for name, cells in re.findall(r'class=c2[^>]*>([^<]+)</div>.*?class=c_avg[^>]*>[^<]*</div></td>(.*?)</tr>',
                                      html_part, re.S):
            vals = re.findall(r'class=ctris>([^<]*)<', cells)
            if len(vals) != len(ids):
                raise ValueError(f"compare: {len(vals)} colunas para {len(ids)} listas")
            for i, v in zip(ids, vals):
                if v.strip():
                    decks[i][part].append(f"{int(v)} {html.unescape(name).strip()}")
    return {i: "\n".join(m + ["Sideboard"] + s) for i, (m, s) in decks.items()}


def parse_deck(text):
    """Texto MTGO -> (Counter principal, Counter sideboard)."""
    main, side = Counter(), Counter()
    cur = main
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.lower().startswith("sideboard"):
            cur = side
            continue
        m = re.match(r"(?:SB:\s*)?(\d+)x?\s+(.+)", line)
        if m:
            cur[clean_name(m.group(2))] += int(m.group(1))
    return main, side


def clean_name(n):
    n = re.sub(r"\*F\*|\*E\*", "", n).strip()
    n = re.sub(r"\s*[\(\[][A-Z0-9]{2,6}[\)\]]\s*[\w-]*$", "", n)  # " (MH3) 123" / " [MH3]"
    n = re.sub(r"\s*/{1,2}\s*", " // ", n)
    return n.strip()


def fold(n):
    n = unicodedata.normalize("NFKD", n).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9/]", "", n)


def load_oracle():
    """nome dobrado (completo e face da frente) -> nome canónico da Scryfall."""
    names = {}
    if not os.path.exists(ORACLE):
        return names
    skip = {"token", "double_faced_token", "emblem", "art_series", "vanguard", "planar", "scheme"}
    with gzip.open(ORACLE, "rt") as fh:
        for line in fh:
            c = json.loads(line)
            if c.get("layout") in skip:
                continue
            full = c["name"]
            names.setdefault(fold(full), full)
            names.setdefault(fold(full.split(" // ")[0]), full)
    return names


# ---------- estatísticas ----------

def build_stats(fmt, decks, arch_names, oracle=None):
    """decks: [(arch_idx, main Counter, side Counter, data ISO)]"""
    def canon(n):
        return oracle.get(fold(n), n) if oracle else n

    rows = []
    for a, main, side, d in decks:
        cm, cs = Counter(), Counter()
        for n, q in main.items():
            cm[canon(n)] += q
        for n, q in side.items():
            cs[canon(n)] += q
        rows.append((a, cm, cs, d))
    N = len(rows)
    mi, mc, si, sc = Counter(), Counter(), Counter(), Counter()
    a_n, a_i, a_c = Counter(), defaultdict(Counter), defaultdict(Counter)
    for a, main, side, _ in rows:
        a_n[a] += 1
        for n, q in main.items():
            mi[n] += 1; mc[n] += q; a_i[a][n] += 1; a_c[a][n] += q
        for n, q in side.items():
            si[n] += 1; sc[n] += q

    order = sorted(a_n, key=lambda a: (-a_n[a], arch_names[a]))
    new_idx = {a: i for i, a in enumerate(order)}
    archetypes = []
    for a in order:
        core = sorted(((n, k) for n, k in a_i[a].items() if n not in BASICS), key=lambda kv: (-kv[1], -a_c[a][kv[0]], kv[0]))[:CORE_N]
        archetypes.append({"name": arch_names[a], "decks": a_n[a], "share": round(a_n[a] / N, 4),
                           "core": [[n, round(k / a_n[a], 3), round(a_c[a][n] / k, 2)] for n, k in core]})

    cards = []
    for n in sorted(set(mi) | set(si), key=lambda n: (-mi[n], -si[n], n)):
        arch = sorted(new_idx[a] for a in a_n if a_n[a] >= 3 and a_i[a][n] / a_n[a] >= 0.5)
        cards.append([n, round(mi[n] / N, 4), round(mc[n] / mi[n], 2) if mi[n] else 0,
                      round(si[n] / N, 4), round(sc[n] / si[n], 2) if si[n] else 0, arch])

    hot = {n for n, k in mi.items() if k / N >= PAIR_MIN_INCL and n not in BASICS}
    co = defaultdict(Counter)
    for _, main, _, _ in rows:
        names = [n for n in main if n not in BASICS]
        for x in names:
            if x in hot:
                for y in names:
                    if y != x:
                        co[x][y] += 1
    pairs = {}
    for x in sorted(hot, key=lambda n: -mi[n]):
        cand = [(y, k * N / (mi[x] * mi[y]), k / mi[x]) for y, k in co[x].items() if k >= PAIR_MIN_CO]
        cand.sort(key=lambda t: (-t[1], -t[2], t[0]))
        if cand:
            pairs[x] = [[y, round(l, 2), round(p, 2)] for y, l, p in cand[:PAIR_TOP]]

    return {"format": fmt, "source": "mtgtop8", "built": datetime.now().isoformat(timespec="seconds"),
            "since": min((d for *_, d in rows), default=None), "decks": N,
            "archetypes": archetypes, "cards": cards, "pairs": pairs}


def write_atomic(path, obj):
    raw = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode()
    for p, data in ((path, raw), (path + ".gz", gzip.compress(raw, 9))):
        with open(p + ".tmp", "wb") as f:
            f.write(data)
        os.replace(p + ".tmp", p)
    return len(raw)


# ---------- recolha ----------

def collect(key, code, max_decks, oracle):
    t0 = time.time()
    periods = parse_periods(fetch(f"format?f={code}"), code)
    if PERIOD not in periods:
        raise RuntimeError(f"período '{PERIOD}' não encontrado ({list(periods)[:5]})")
    meta = periods[PERIOD]
    archs = parse_archetypes(fetch(f"format?f={code}&meta={meta}"), code, meta)
    if not archs:
        raise RuntimeError("nenhum arquétipo na página do formato")
    total = sum(p for *_, p in archs)
    quotas = {a: round(p / total * max_decks) for a, _, p in archs}
    names = {a: n for a, n, _ in archs}
    print(f"  {len(archs)} arquétipos (meta={meta}); a recolher {sum(quotas.values())} listas", flush=True)

    picked = []  # (deck_id, arch, data)
    seen = set()
    for a, _, _ in archs:
        q, page = quotas[a], 1
        got = []
        while len(got) < q:
            path = f"archetype?a={a}&meta={meta}&f={code}"
            rows = parse_archetype_page(fetch(path, {"current_page": page} if page > 1 else None))
            got += [r for r in rows if r[0] not in seen and not seen.add(r[0])]
            if len(rows) < 20:
                break
            page += 1
        picked += [(d, a, dt) for d, dt in got[:q]]

    os.makedirs(RAW, exist_ok=True)
    cache = lambda d: os.path.join(RAW, f"{d}.txt")
    todo = [d for d, _, _ in picked if not os.path.exists(cache(d))]
    fails = 0
    for i in range(0, len(todo), 20):
        batch = todo[i:i + 20]
        try:
            texts = parse_compare(fetch("compare?l=_" + "_".join(map(str, batch)) + "_"), batch)
        except Exception as e:
            print(f"    ! compare falhou ({e}); a usar mtgo?d=", flush=True)
            texts = {}
        for d in batch:
            t = texts.get(d)
            if t is None or sum(parse_deck(t)[0].values()) < 40:
                try:
                    t = fetch(f"mtgo?d={d}")
                except Exception as e:
                    fails += 1
                    print(f"    ! lista {d}: {e}", flush=True)
                    if fails >= 5:
                        raise RuntimeError("demasiadas falhas ao obter listas")
                    continue
            with open(cache(d) + ".tmp", "w") as f:
                f.write(t)
            os.replace(cache(d) + ".tmp", cache(d))
        print(f"    listas novas: {min(i + 20, len(todo))}/{len(todo)}", flush=True)

    decks, by_arch = [], {}
    for d, a, dt in picked:
        if os.path.exists(cache(d)):
            with open(cache(d)) as f:
                main, side = parse_deck(f.read())
            if sum(main.values()) >= 40:
                decks.append((a, main, side, dt))
                by_arch.setdefault(names[a], []).append(d)
    if len(decks) < 20:
        raise RuntimeError(f"só {len(decks)} listas válidas")
    stats = build_stats(key, decks, names, oracle)
    size = write_atomic(os.path.join(OUT, f"{key}.json"), stats)
    with open(os.path.join(OUT, f"{key}.decks.json.tmp"), "w") as f:  # adversários do laboratório (sim.py)
        json.dump(by_arch, f, ensure_ascii=False)
    os.replace(os.path.join(OUT, f"{key}.decks.json.tmp"), os.path.join(OUT, f"{key}.decks.json"))
    known = set(oracle.values())
    unknown = [c[0] for c in stats["cards"] if oracle and c[0] not in known]
    if unknown:
        print(f"  nomes fora da Scryfall ({len(unknown)}): {', '.join(unknown[:8])}", flush=True)
    print(f"  {key}: {len(decks)} listas ({len(todo)} novas, {len(picked) - len(todo)} em cache), "
          f"{len(stats['archetypes'])} arquétipos, {len(stats['cards'])} cartas, "
          f"{len(stats['pairs'])} com pares, {size // 1024} KB, {time.time() - t0:.0f} s", flush=True)
    return stats


def selfcheck():
    txt = "4 Lightning Bolt\n2 Fire/Ice\n1 Ragavan, Nimble Pilferer (MH2) 138 *F*\n\nSideboard\n2 Blood Moon\n"
    m, s = parse_deck(txt)
    assert m == Counter({"Lightning Bolt": 4, "Fire // Ice": 2, "Ragavan, Nimble Pilferer": 1}), m
    assert s == Counter({"Blood Moon": 2}), s

    row = ('<div class=c2 onclick="x">{}</div><div><a href=compare?l=_1_></a></div></div></td>'
           '<td width=40 align=center><div class=c_avg>2</div></td>{}</tr>')
    cell = lambda v: f"<td><div  class=ctris>{v}</div></td>"
    page = (row.format("Lightning Bolt", cell(4) + cell("")) + row.format("Death&#039;s Shadow", cell(1) + cell(2)) +
            '<td align=center width=250>SIDEBOARDS</td>' + row.format("Blood Moon", cell("") + cell(3)))
    out = parse_compare(page, [11, 22])
    assert parse_deck(out[11]) == (Counter({"Lightning Bolt": 4, "Death's Shadow": 1}), Counter()), out
    assert parse_deck(out[22]) == (Counter({"Death's Shadow": 2}), Counter({"Blood Moon": 3})), out

    D = lambda **k: Counter(k)
    decks = [(1, D(A=4, B=4, Mountain=10), D(S=2), "2026-10-01")] * 6 + \
            [(2, D(A=2, C=4, Island=10), D(), "2026-09-01")] * 4
    st = build_stats("teste", decks, {1: "Burn", 2: "Tempo"})
    assert st["decks"] == 10 and st["since"] == "2026-09-01"
    assert [a["name"] for a in st["archetypes"]] == ["Burn", "Tempo"]
    assert abs(sum(a["share"] for a in st["archetypes"]) - 1) < 1e-9
    cards = {c[0]: c for c in st["cards"]}
    assert cards["A"] == ["A", 1.0, 3.2, 0.0, 0, [0, 1]], cards["A"]
    assert cards["B"][1:3] == [0.6, 4.0] and cards["B"][5] == [0]
    assert cards["S"][3:5] == [0.6, 2.0]
    assert st["pairs"]["B"][0] == ["A", 1.0, 1.0], st["pairs"]
    assert "Mountain" not in st["pairs"] and all(p[0] != "Mountain" for p in st["pairs"]["A"])
    assert st["archetypes"][0]["core"][0][:2] == ["A", 1.0]
    print("selfcheck ok")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--formats", default=",".join(FORMATS))
    ap.add_argument("--max-decks", type=int, default=400)
    ap.add_argument("--selfcheck", action="store_true")
    args = ap.parse_args()
    if args.selfcheck:
        return selfcheck()
    oracle = load_oracle()
    print(f"oracle: {len(oracle)} nomes" if oracle else "oracle: em falta, nomes sem normalização", flush=True)
    os.makedirs(OUT, exist_ok=True)
    bad = 0
    for key in args.formats.split(","):
        key = key.strip()
        if key not in FORMATS:
            print(f"formato desconhecido: {key}"); bad += 1; continue
        print(f"[{key}] {FORMATS[key]}", flush=True)
        try:
            collect(key, FORMATS[key], args.max_decks, oracle)
        except Exception as e:
            bad += 1
            print(f"  ! {key} abortado, JSON anterior mantido: {e}", flush=True)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
