"""Grimório — importar um deck a partir do URL de um site (só biblioteca padrão).

fetch_deck(url) -> {"name", "format", "source", "text"[, "cover"][, "art"]}, onde `text` é uma lista
normalizada que o parseList do frontend já percebe (e `art` = {nome: imagem https} escolhida pelo dono
no site, só no TappedOut; nos outros a arte vem das edições «(SET) nº»):

    Commander
    1 Atraxa, Praetors' Voice

    Deck
    1 Sol Ring (CMR) 263 *F*

    Sideboard
    2 Duress

    Maybeboard
    1 Opt

Segurança: o URL do utilizador só serve para reconhecer o site e extrair o id;
o pedido vai sempre para um URL https construído aqui, num host da lista FETCH_HOSTS,
e os redireccionamentos só são seguidos para https no mesmo site.

Erros: DeckError(ValueError) (URL não suportado, deck privado/inexistente) e UpstreamError
(rede, site em baixo, Cloudflare), ambos com mensagem em pt-PT.

Uso: python3 deck_import.py <url>   |   python3 deck_import.py --selfcheck
"""
import html, json, re, sys, urllib.error, urllib.parse, urllib.request

UA = "Mozilla/5.0 (compatible; Grimorio/1.0; uso pessoal)"
MAX_BYTES = 5_000_000
SITES = {"moxfield.com": "moxfield", "archidekt.com": "archidekt", "tappedout.net": "tappedout",
         "mtggoldfish.com": "mtggoldfish", "deckstats.net": "deckstats", "aetherhub.com": "aetherhub",
         "mtgtop8.com": "mtgtop8", "scryfall.com": "scryfall"}
LABEL = {"moxfield": "Moxfield", "archidekt": "Archidekt", "tappedout": "TappedOut",
         "mtggoldfish": "MTGGoldfish", "deckstats": "Deckstats", "aetherhub": "AetherHub",
         "mtgtop8": "MTGTop8", "scryfall": "Scryfall"}
FETCH_HOSTS = {"api2.moxfield.com", "archidekt.com", "www.archidekt.com", "tappedout.net",
               "www.mtggoldfish.com", "deckstats.net", "www.mtgtop8.com", "mtgtop8.com", "api.scryfall.com"}
UNSUPPORTED = ("Endereço não suportado. Sites aceites: Moxfield, Archidekt, TappedOut, MTGGoldfish, "
               "Deckstats, AetherHub, MTGTop8 e Scryfall (endereço completo do deck).")
# nomes de formato dos sites -> chaves do Grimório (web/src/formats.js)
FMT_ALIAS = {"edh": "commander", "cedh": "commander", "duel commander": "duel", "dual commander": "duel",
             "1v1 commander": "duel", "pauper edh": "paupercommander", "pauperedh": "paupercommander",
             "penny dreadful": "penny", "pennydreadful": "penny", "historic brawl": "brawl",
             "historicbrawl": "brawl", "competitive brawl": "brawl", "standard brawl": "standardbrawl",
             "old school": "oldschool"}
ARCHIDEKT_FMT = {1: "standard", 2: "modern", 3: "commander", 4: "legacy", 5: "vintage", 6: "pauper",
                 8: "frontier", 9: "future standard", 10: "penny", 11: "duel", 12: "duel",
                 13: "standardbrawl", 14: "oathbreaker", 15: "pioneer", 16: "historic",
                 17: "paupercommander", 18: "alchemy", 19: "explorer", 20: "brawl", 21: "gladiator",
                 22: "premodern", 23: "predh", 24: "timeless", 25: "canadian highlander", 26: "brawl"}
MTGTOP8_FMT = {"ST": "standard", "PI": "pioneer", "MO": "modern", "LE": "legacy", "VI": "vintage",
               "PAU": "pauper", "PREM": "premodern", "EDH": "duel", "cEDH": "commander",
               "EXP": "explorer", "HI": "historic", "ALCH": "alchemy", "PEA": "peasant"}
MTGTOP8_CMD = {"EDH", "cEDH"}  # nestes formatos a secção "Sideboard" do export são os comandantes


class DeckError(ValueError):
    """URL não suportado, deck privado ou inexistente (mensagem pt-PT para o utilizador)."""


class UpstreamError(Exception):
    """Rede, Cloudflare ou resposta inesperada do site (mensagem pt-PT)."""


def _blocked(site):
    how = " (no Moxfield: Export → Copy)" if site == "moxfield" else ""
    return UpstreamError(f"O {LABEL[site]} bloqueia pedidos automáticos (proteção Cloudflare). Abre o deck "
                         f"no site, copia a lista em texto{how} e cola-a em «Importar lista».")


def _site_of(host):
    host = (host or "").lower().rstrip(".")
    return SITES.get(host[4:] if host.startswith("www.") else host)


class _SameSite(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        u = urllib.parse.urlparse(urllib.parse.urljoin(req.full_url, newurl))
        if u.scheme != "https" or u.hostname not in FETCH_HOSTS or \
                _site_of(u.hostname) != _site_of(urllib.parse.urlparse(req.full_url).hostname):
            raise UpstreamError("O site redireccionou para um endereço não permitido.")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_OPENER = urllib.request.build_opener(_SameSite)


def _get(url, site):
    """GET https a um host da lista; no máximo uma repetição em falhas de rede/5xx."""
    u = urllib.parse.urlparse(url)
    if u.scheme != "https" or u.hostname not in FETCH_HOSTS:
        raise UpstreamError("Endereço de origem não permitido.")
    for attempt in (0, 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json, text/plain, text/html;q=0.9, */*;q=0.5"})
            with _OPENER.open(req, timeout=15) as r:
                data = r.read(MAX_BYTES + 1)
                charset = r.headers.get_content_charset() or "utf-8"
            if len(data) > MAX_BYTES:
                raise UpstreamError(f"A resposta do {LABEL[site]} é demasiado grande.")
            return data.decode(charset, "replace")
        except urllib.error.HTTPError as e:
            body = e.read(50_000).decode("utf-8", "replace")
            if e.headers.get("cf-mitigated") or re.search(r"Just a moment|Attention Required|cf-error-details", body):
                raise _blocked(site)
            if e.code in (401, 403):
                raise DeckError(f"O deck no {LABEL[site]} é privado ou não está acessível.")
            if e.code in (400, 404, 410):
                raise DeckError(f"Deck não encontrado no {LABEL[site]}.")
            if attempt or e.code < 500:
                raise UpstreamError(f"O {LABEL[site]} respondeu com erro {e.code}.")
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            if attempt:
                why = getattr(e, "reason", None) or e
                raise UpstreamError(f"Não foi possível contactar o {LABEL[site]} ({str(why)[:80]}).")


def parse_url(url):
    """URL do utilizador -> (site, {ids}). Só reconhece; nunca é pedido tal como vem."""
    url = (url or "").strip()
    if "://" not in url:
        url = "https://" + url
    try:
        u = urllib.parse.urlparse(url)
        port = u.port
    except ValueError:
        raise DeckError(UNSUPPORTED)
    site = _site_of(u.hostname)
    if u.scheme not in ("http", "https") or not site or port or u.username or u.password:
        raise DeckError(UNSUPPORTED)
    q = urllib.parse.parse_qs(u.query)
    path = u.path
    m = None
    if site == "moxfield":
        m = re.match(r"^/decks/([A-Za-z0-9_-]{5,40})/?", path)
        ids = m and {"id": m.group(1)}
    elif site == "archidekt":
        m = re.match(r"^/(?:api/)?decks/(\d+)", path)
        ids = m and {"id": m.group(1)}
    elif site == "tappedout":
        m = re.match(r"^/mtg-decks/([a-z0-9-]{1,120})/?", path)
        ids = m and {"slug": m.group(1)}
    elif site == "mtggoldfish":
        m = re.match(r"^/(deck|archetype)/(?:download/)?([a-z0-9-]{1,120})/?$", path)
        ids = m and {"kind": m.group(1), "id": m.group(2)}
    elif site == "deckstats":
        m = re.match(r"^/decks/(\d+)/(\d+)(-[A-Za-z0-9-]*)?", path)
        ids = m and {"user": m.group(1), "id": m.group(2), "slug": m.group(3) or ""}
    elif site == "aetherhub":
        m = re.match(r"^/(?:deck|metagame)/", path, re.I)
        ids = m and {}
    elif site == "mtgtop8":
        d, f = q.get("d", [""])[0], q.get("f", [""])[0]
        m = re.fullmatch(r"\d{1,9}", d)
        ids = m and {"d": d, "f": f if re.fullmatch(r"[A-Za-z]{1,6}", f) else ""}
    elif site == "scryfall":
        m = re.match(r"^/@[^/]+/decks/([0-9a-f-]{36})", path)
        ids = m and {"id": m.group(1)}
    if not m:
        raise DeckError(f"Não reconheço um deck neste endereço do {LABEL[site]}. Usa o endereço da página do deck.")
    return site, ids


# ---------- normalização ----------

def _line(q, name, set_=None, cn=None, foil=None):
    name = re.sub(r"\s+", " ", html.unescape(name or "")).strip()
    if "/" in name and "(" not in name:  # "Wear/Tear" -> "Wear // Tear"
        name = re.sub(r"\s*/{1,2}\s*", " // ", name)
    s = f"{int(q)} {name}"
    if set_ and cn and re.fullmatch(r"[A-Za-z0-9]{2,6}", set_) and re.fullmatch(r"[A-Za-z0-9_★-]+", str(cn)):
        s += f" ({set_.upper()}) {cn}"
    if foil in ("F", "E"):
        s += f" *{foil}*"
    return s


def _text(cmd, main, side, maybe=()):
    """Listas de tuplos (qtd, nome[, set, cn, foil]) -> texto com secções (vazias omitidas)."""
    out = []
    for title, rows in (("Commander", cmd), ("Deck", main), ("Sideboard", side), ("Maybeboard", maybe)):
        rows = [r for r in rows if r[1] and int(r[0]) > 0]
        if rows:
            out += [title] + [_line(*r) for r in rows] + [""]
    if not out or out[0] == "Maybeboard":  # só maybeboard não é um deck
        raise DeckError("O deck está vazio ou não consegui ler a lista.")
    return "\n".join(out)


def _fmt(f):
    f = re.sub(r"\s+", " ", str(f or "")).strip().lower()
    return None if f in ("", "none", "custom", "casual") else FMT_ALIAS.get(f, f)


def _finish(f):
    return {"foil": "F", "etched": "E"}.get(str(f or "").lower())


def _parse_text(txt, side_is_commander=False, commanders=()):
    """Lista em texto (MTGO, MTGGoldfish, Deckstats) -> (cmd, main, side)."""
    cmd, main, side, maybe = [(1, c) for c in commanders], [], [], []
    zone = main
    for raw in txt.splitlines():
        line = raw.strip()
        hdr = line.lower().lstrip("/ ").rstrip(": ")
        if not line:
            continue
        if hdr in ("sideboard", "side"):
            zone = cmd if side_is_commander else side
            continue
        if hdr in ("main", "mainboard", "deck", "maindeck"):
            zone = main
            continue
        if hdr in ("commander", "commanders"):
            zone = cmd
            continue
        if hdr.startswith(("maybeboard", "considering")):
            zone = maybe
            continue
        if hdr.startswith("tokens"):
            zone = None
            continue
        if line.startswith(("#", "//")):
            continue
        z = zone
        if line.lower().startswith("sb:"):
            z, line = side, line[3:].strip()
        m = re.match(r"^(\d+)\s*x?\s+(.+)$", line, re.I)
        if not m or z is None:
            continue
        name = m.group(2)
        if re.search(r"#\s*!commander", name, re.I):
            z = cmd
        z.append((int(m.group(1)), re.sub(r"\s+#.*$", "", name).strip()))
    for c in commanders:  # o MTGGoldfish repete o comandante na lista principal
        for i, r in enumerate(main):
            if r[1].lower() == c.lower():
                main[i] = (r[0] - 1, r[1])
                break
    return cmd, main, side, maybe


# ---------- sites ----------

def _moxfield(ids):
    d = json.loads(_get(f"https://api2.moxfield.com/v3/decks/all/{ids['id']}", "moxfield"))
    boards = d.get("boards") or {}

    def rows(*names):
        out = []
        for b in names:
            for e in ((boards.get(b) or {}).get("cards") or {}).values():
                c = e.get("card") or {}
                foil = _finish(e.get("finish")) or ("F" if e.get("isFoil") else None)
                out.append((e.get("quantity") or 1, c.get("name"), c.get("set"), c.get("cn"), foil))
        return out
    main = (d.get("main") or {}).get("scryfall_id")  # carta de destaque do deck -> arte da Scryfall
    cover = f"https://cards.scryfall.io/art_crop/front/{main[0]}/{main[1]}/{main}.jpg" if main and len(main) > 2 else None
    return d.get("name"), d.get("format"), _text(rows("commanders"), rows("mainboard", "signatureSpells"),
                                                 rows("sideboard", "companions"), rows("maybeboard")), cover


def _archidekt(ids):
    d = json.loads(_get(f"https://archidekt.com/api/decks/{ids['id']}/", "archidekt"))
    included = {c.get("name"): c.get("includedInDeck", True) for c in d.get("categories") or []}
    cmd, main, side, maybe = [], [], [], []
    for e in d.get("cards") or []:
        if e.get("deletedAt"):
            continue
        cats = e.get("categories") or []
        first = cats[0] if cats else ""
        if "Commander" in cats:
            z = cmd
        elif first == "Sideboard":
            z = side
        elif first == "Maybeboard" or not included.get(first, True):  # categorias fora do deck = maybeboard
            z = maybe
        else:
            z = main
        c = e.get("card") or {}
        mod = str(e.get("modifier") or "")
        z.append((e.get("quantity") or 1, (c.get("oracleCard") or {}).get("name"),
                  (c.get("edition") or {}).get("editioncode"), c.get("collectorNumber"),
                  "E" if "Etched" in mod else "F" if "Foil" in mod else None))
    # capa: a imagem personalizada do dono, senão a arte de destaque escolhida no Archidekt
    return d.get("name"), ARCHIDEKT_FMT.get(d.get("deckFormat")), _text(cmd, main, side, maybe), d.get("customFeatured") or d.get("featured")


def _tappedout(ids):
    # A página e o ?fmt=txt estão atrás de Cloudflare; o widget de incorporação não.
    d = json.loads(_get(f"https://tappedout.net/api/deck/widget/?deck={ids['slug']}", "tappedout"))
    # data-card-img = a imagem que o dono escolheu para cada carta (edição ou arte alterada «*A*»)
    cmd, main, side, maybe, art = [], [], [], [], {}
    for h3, body in re.findall(r"<h3[^>]*>([^<]*)</h3>(.*?)(?=<h3|\Z)", d.get("board") or "", re.S):
        sec = h3.split("(")[0].strip().lower()
        z = cmd if sec.startswith("commander") else side if sec == "sideboard" else \
            maybe if sec in ("maybeboard", "considering") else None if sec == "acquireboard" else main
        for q, attrs, n in re.findall(r'tappedout-member[^>]*>\s*(\d+)x.*?class="card-link([^>]*)>([^<]*)</a>', body, re.S) if z is not None else []:
            z.append((int(q), n))
            src = re.search(r'data-card-img="(?:https:)?//(static\.tappedout\.net/[^"\s<>]+)"', attrs)
            if src:
                art.setdefault(_line(1, n)[2:], "https://" + html.unescape(src.group(1)))
    return d.get("title"), None, _text(cmd, main, side, maybe), None, art


def _mtggoldfish(ids):
    # /archetype/... é público; /deck/<id> costuma estar atrás de Cloudflare (-> _blocked).
    page = _get(f"https://www.mtggoldfish.com/{ids['kind']}/{ids['id']}", "mtggoldfish")

    def field(f):
        m = re.search(r'name="deck_input\[%s\]"[^>]*?value="([^"]*)"' % f, page)
        return html.unescape(m.group(1)).strip() if m else ""
    if not field("deck"):
        raise DeckError("Deck não encontrado no MTGGoldfish.")
    cmds = [c for c in (field("commander"), field("commander_alt")) if c]
    return field("name"), field("format"), _text(*_parse_text(field("deck"), commanders=cmds))


def _deckstats(ids):
    # include_comments=1 marca o comandante com "# !Commander"; o export não traz nome nem formato.
    txt = _get(f"https://deckstats.net/decks/{ids['user']}/{ids['id']}{ids['slug']}?export_txt=1&include_comments=1", "deckstats")
    return ids["slug"].strip("-").replace("-", " ").title(), None, _text(*_parse_text(txt))


def _aetherhub(ids):
    raise _blocked("aetherhub")  # todos os endpoints (página e exports) pedem desafio Cloudflare


def _mtgtop8(ids):
    f = ids["f"]
    txt = _get(f"https://www.mtgtop8.com/mtgo?d={ids['d']}", "mtgtop8")
    try:  # nome do deck = título da página ("5c Domain - Dario Casati @ mtgtop8.com")
        m = re.search(r"<title>([^<]*?)\s*@ mtgtop8\.com", _get(f"https://www.mtgtop8.com/event?d={ids['d']}", "mtgtop8"))
        name = html.unescape(m.group(1)).strip() if m else None
    except Exception:
        name = None
    return name, MTGTOP8_FMT.get(f), _text(*_parse_text(txt, side_is_commander=f in MTGTOP8_CMD))


def _scryfall(ids):
    d = json.loads(_get(f"https://api.scryfall.com/decks/{ids['id']}/export/json", "scryfall"))
    cmd, main, side, maybe = [], [], [], []
    for sec, entries in (d.get("entries") or {}).items():
        z = cmd if sec == "commanders" else side if sec == "sideboard" else maybe if sec == "maybeboard" else \
            None if sec in ("outside", "tokens") else main
        for e in entries if z is not None else []:
            c = e.get("card_digest") or {}
            name = c.get("name") or re.sub(r"^\d+x?\s+", "", e.get("raw_text") or "")
            pr = e.get("printing_specified")
            z.append((e.get("count") or 0, name, pr and c.get("set"), pr and c.get("collector_number"),
                      _finish(e.get("finish"))))
    return d.get("name"), d.get("format"), _text(cmd, main, side, maybe)


def list_profile(url):
    """Perfil de utilizador -> [{name, url, format, count}] dos decks públicos.
    Archidekt tem API pública; o TappedOut bloqueia o servidor (Cloudflare): usa-se o favorito no browser."""
    raw = (url or "").strip()
    u = urllib.parse.urlparse(raw if "://" in raw else "https://" + raw)
    site = _site_of(u.hostname)
    parts = [x for x in u.path.split("/") if x]
    if site == "archidekt" and len(parts) >= 2 and parts[0] in ("u", "user"):
        user = urllib.parse.unquote(parts[1])
        out, page = [], 1
        while page <= 10:
            d = json.loads(_get(f"https://archidekt.com/api/decks/v3/?ownerUsername={urllib.parse.quote(user)}&pageSize=50&page={page}", "archidekt"))
            for x in d.get("results", []):
                fmt = ARCHIDEKT_FMT.get(x.get("deckFormat"))
                out.append({"name": x.get("name") or "Deck", "url": f"https://archidekt.com/decks/{x['id']}/", "format": fmt, "count": x.get("size")})
            if not d.get("next"):
                break
            page += 1
        if not out:
            raise DeckError("Este perfil do Archidekt não tem decks públicos.")
        return out
    if site == "tappedout":
        raise DeckError("O TappedOut não deixa o servidor ler perfis (Cloudflare). Usa o favorito «Grimório: levar decks» "
                        "na tua página de perfil do TappedOut, ou cola aqui os links dos decks.")
    raise DeckError("Perfis suportados: Archidekt (archidekt.com/u/<nome>). Para o TappedOut usa o favorito; "
                    "de outros sites, cola os links dos decks.")


COLOR_NAMES = {"W": "White", "U": "Blue", "B": "Black", "R": "Red", "G": "Green", "C": "Colorless"}
ORDER = {"vistos": "-viewCount", "novos": "-createdAt", "atualizados": "-updatedAt"}


def search_decks(q="", fmt="", colors="", card="", order="vistos", page=1):
    """Pesquisa decks públicos no Archidekt (o único site que deixa o servidor pesquisar; os outros têm Cloudflare).
    -> {"count", "decks": [{name, url, format, colors, owner, views, size, cover, updated, bracket}]}"""
    rev = {v: k for k, v in ARCHIDEKT_FMT.items()}
    par = {"name": q.strip()[:80], "orderBy": ORDER.get(order, "-viewCount"), "page": max(1, min(int(page or 1), 50))}
    if fmt in rev:
        par["deckFormat"] = rev[fmt]
    cs = [COLOR_NAMES[c] for c in str(colors).upper() if c in COLOR_NAMES]
    if cs:
        par["colors"], par["andcolors"] = ",".join(cs), "true"
    if card.strip():
        par["cardName"] = card.strip()[:80]
    d = json.loads(_get("https://archidekt.com/api/decks/v3/?" + urllib.parse.urlencode({k: v for k, v in par.items() if v}), "archidekt"))
    out = []
    for x in d.get("results") or []:
        if x.get("private") or x.get("unlisted"):
            continue
        out.append({"name": x.get("name") or "Deck", "url": f"https://archidekt.com/decks/{x['id']}/", "format": ARCHIDEKT_FMT.get(x.get("deckFormat")),
                    "colors": "".join(k for k in "WUBRG" if (x.get("colors") or {}).get(k)), "owner": (x.get("owner") or {}).get("username"),
                    "views": x.get("viewCount"), "size": x.get("size"), "cover": x.get("customFeatured") or x.get("featured") or None,
                    "updated": x.get("updatedAt"), "bracket": x.get("edhBracket")})
    return {"count": d.get("count") or len(out), "next": bool(d.get("next")), "decks": out}


def fetch_deck(url):
    site, ids = parse_url(url)
    try:
        r = globals()["_" + site](ids)  # (nome, formato, lista[, capa[, arte]])
        name, fmt, text = r[:3]
        cover = r[3] if len(r) > 3 and str(r[3] or "").startswith("https://") else None
        art = r[4] if len(r) > 4 else None
    except (DeckError, UpstreamError):
        raise
    except Exception:  # JSON/HTML com outra forma: o site mudou
        raise UpstreamError(f"O {LABEL[site]} devolveu uma resposta inesperada.")
    return {"name": (name or "").strip()[:200] or f"Deck do {LABEL[site]}", "format": _fmt(fmt),
            "source": site, "text": text, **({"cover": cover} if cover else {}), **({"art": art} if art else {})}


# ---------- verificação ----------

def _selfcheck():
    bad = ["http://192.168.0.10:3000", "https://127.0.0.1/decks/1", "file:///etc/passwd",
           "https://evil.com/moxfield.com/decks/abc", "https://moxfield.com.evil.com/decks/abcdef",
           "https://user@archidekt.com/decks/1", "https://archidekt.com:8443/decks/1", "ftp://archidekt.com/decks/1", ""]
    for u in bad:
        try:
            parse_url(u)
            raise AssertionError(u)
        except DeckError:
            pass
    ok = {"https://www.moxfield.com/decks/oEWXWHM5eEGMmopExLWRCA": ("moxfield", {"id": "oEWXWHM5eEGMmopExLWRCA"}),
          "moxfield.com/decks/abc_DEF-12": ("moxfield", {"id": "abc_DEF-12"}),
          "https://archidekt.com/decks/7031486/buffs_by_hans": ("archidekt", {"id": "7031486"}),
          "http://tappedout.net/mtg-decks/the-ur-dragon-1/": ("tappedout", {"slug": "the-ur-dragon-1"}),
          "https://www.mtggoldfish.com/archetype/modern-affinity#paper": ("mtggoldfish", {"kind": "archetype", "id": "modern-affinity"}),
          "https://www.mtggoldfish.com/deck/download/1030459": ("mtggoldfish", {"kind": "deck", "id": "1030459"}),
          "https://deckstats.net/decks/243050/3335557-atraxa/en": ("deckstats", {"user": "243050", "id": "3335557", "slug": "-atraxa"}),
          "https://mtgtop8.com/event?e=92597&d=903378&f=MO": ("mtgtop8", {"d": "903378", "f": "MO"}),
          "https://scryfall.com/@x/decks/d9489802-5c39-4e00-866d-fc82015ef15c?as=list": ("scryfall", {"id": "d9489802-5c39-4e00-866d-fc82015ef15c"})}
    for u, want in ok.items():
        assert parse_url(u) == want, (u, parse_url(u))
    # MTGTop8 cEDH: secção Sideboard = comandantes; split com uma barra
    t = _text(*_parse_text("1 Sol Ring\r\n1 Wear/Tear\r\nSideboard\r\n1 Thrasios, Triton Hero\r\n", True))
    assert t == "Commander\n1 Thrasios, Triton Hero\n\nDeck\n1 Sol Ring\n1 Wear // Tear\n", t
    # MTGGoldfish: comandante repetido na lista, cabeçalho "sideboard" em minúsculas
    t = _text(*_parse_text("1 Atraxa, Praetors' Voice\n1 Sol Ring\nsideboard\n2 Duress\n", commanders=["Atraxa, Praetors' Voice"]))
    assert t == "Commander\n1 Atraxa, Praetors' Voice\n\nDeck\n1 Sol Ring\n\nSideboard\n2 Duress\n", t
    # Deckstats-like
    t = _text(*_parse_text("//NAME: X\n//Main\n1 Atraxa, Praetors' Voice # !Commander\n4 Island\n//Sideboard\nSB: 1 Negate\n//Maybeboard\n1 Opt\n"))
    assert t == "Commander\n1 Atraxa, Praetors' Voice\n\nDeck\n4 Island\n\nSideboard\n1 Negate\n\nMaybeboard\n1 Opt\n", t
    try:  # só maybeboard não chega para ser um deck
        _text([], [], [], [(1, "Opt")])
        raise AssertionError("só maybe")
    except DeckError:
        pass
    assert _line(1, "Sol Ring", "cmr", "263", "F") == "1 Sol Ring (CMR) 263 *F*"
    assert _line(1, "Sol Ring", "cmr", "263 a") == "1 Sol Ring"  # nº de colecção estranho: sem edição
    assert _line(2, "Fire &amp; Ice") == "2 Fire & Ice"
    try:
        _text([], [], [])
        raise AssertionError("vazio")
    except DeckError:
        pass
    # Sites com amostras de payload (sem rede)
    global _get
    real, payloads = _get, {}
    _get = lambda url, site: payloads[site]
    try:
        payloads["moxfield"] = json.dumps({"name": "M", "format": "commander", "boards": {
            "commanders": {"cards": {"a": {"quantity": 1, "finish": "foil", "card": {"name": "Atraxa, Praetors' Voice", "set": "c16", "cn": "28"}}}},
            "mainboard": {"cards": {"b": {"quantity": 1, "card": {"name": "Sol Ring", "set": "cmr", "cn": "263"}}}},
            "maybeboard": {"cards": {"c": {"quantity": 1, "card": {"name": "Opt"}}}}}})
        assert fetch_deck("https://moxfield.com/decks/abcdef") == {"name": "M", "format": "commander", "source": "moxfield",
            "text": "Commander\n1 Atraxa, Praetors' Voice (C16) 28 *F*\n\nDeck\n1 Sol Ring (CMR) 263\n\nMaybeboard\n1 Opt\n"}
        card = lambda n, s, cn: {"oracleCard": {"name": n}, "edition": {"editioncode": s}, "collectorNumber": cn}
        payloads["archidekt"] = json.dumps({"name": "A", "deckFormat": 3,
            "categories": [{"name": "Ramp", "includedInDeck": True}, {"name": "Maybe", "includedInDeck": False},
                           {"name": "Sideboard", "includedInDeck": False}],
            "cards": [{"quantity": 1, "categories": ["Commander"], "modifier": "Normal", "card": card("Atraxa, Praetors' Voice", "c16", "28")},
                      {"quantity": 1, "categories": ["Ramp"], "modifier": "Foil", "card": card("Sol Ring", "cmr", "263")},
                      {"quantity": 1, "categories": ["Maybe"], "card": card("Opt", "xln", "65")},
                      {"quantity": 2, "categories": ["Sideboard"], "card": card("Duress", "m19", "94")}]})
        assert fetch_deck("archidekt.com/decks/1/x")["text"] == \
            "Commander\n1 Atraxa, Praetors' Voice (C16) 28\n\nDeck\n1 Sol Ring (CMR) 263 *F*\n\nSideboard\n2 Duress (M19) 94\n\nMaybeboard\n1 Opt (XLN) 65\n"
        li = lambda q, n, im="": (f'<li class="tappedout-member" id="x">\n {q}x\n<span><a rel="popover" class="card-link alter-card card-hover" href="#"'
                                  f'{f" data-card-img={chr(34)}{im}{chr(34)}" if im else ""} data-card-alt="MTG Card: {n}">{n}</a> *A*</span></li>')
        alt = "//static.tappedout.net/mtg-cards-2/x/island/_user-added/me-island-1.png"
        payloads["tappedout"] = json.dumps({"title": "T", "board": f"<h3>Land (4)</h3><ul>{li(3, 'Island', alt)}{li(1, 'Island', '//static.tappedout.net/b.jpg')}</ul>"
                                            f"<h3>Commander</h3><ul>{li(1, 'Talrand, Sky Summoner', '//evil.example/x.png')}</ul><h3>Sideboard</h3>{li(1, 'Aether Spellbomb')}"
                                            f"<h3>Maybeboard (1)</h3>{li(1, 'Fire/Ice', '//static.tappedout.net/f.jpg')}<h3>Acquireboard</h3>{li(1, 'Opt')}"})
        t = fetch_deck("https://tappedout.net/mtg-decks/x/")
        assert t["text"] == "Commander\n1 Talrand, Sky Summoner\n\nDeck\n3 Island\n1 Island\n\nSideboard\n1 Aether Spellbomb\n\nMaybeboard\n1 Fire // Ice\n", t["text"]
        # arte: a primeira imagem de cada carta, só do static.tappedout.net, sempre https
        assert t["art"] == {"Island": "https:" + alt, "Fire // Ice": "https://static.tappedout.net/f.jpg"}, t["art"]
        payloads["scryfall"] = json.dumps({"name": "S", "format": "commander", "entries": {
            "commanders": [{"count": 1, "printing_specified": True, "finish": "etched", "card_digest": {"name": "Niv-Mizzet, Parun", "set": "grn", "collector_number": "192"}}],
            "lands": [{"count": 30, "printing_specified": False, "card_digest": {"name": "Island", "set": "znr", "collector_number": "1"}}],
            "maybeboard": [{"count": 1, "card_digest": {"name": "Opt"}}]}})
        assert fetch_deck("https://scryfall.com/@a/decks/d9489802-5c39-4e00-866d-fc82015ef15c")["text"] == \
            "Commander\n1 Niv-Mizzet, Parun (GRN) 192 *E*\n\nDeck\n30 Island\n\nMaybeboard\n1 Opt\n"
        payloads["archidekt"] = "<html>not json</html>"
        try:
            fetch_deck("archidekt.com/decks/1")
            raise AssertionError("html")
        except UpstreamError:
            pass
    finally:
        _get = real
    print("selfcheck ok")


if __name__ == "__main__":
    if sys.argv[1:] == ["--selfcheck"]:
        _selfcheck()
    elif len(sys.argv) == 2:
        try:
            d = fetch_deck(sys.argv[1])
        except (DeckError, UpstreamError) as e:
            sys.exit(f"erro: {e}")
        print(f"# {d['name']} | formato={d['format']} | fonte={d['source']}")
        print(d["text"])
    else:
        sys.exit(__doc__.strip().splitlines()[-1])
