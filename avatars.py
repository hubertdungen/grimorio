"""Imagens de perfil: a de quem aloja (ou de cada perfil, nas edições sem login) e a de cada amigo convidado.

Duas maneiras: uma imagem carregada (a app corta-a num quadrado de ~256 px e comprime-a em WebP ou JPEG antes de a
mandar) ou a arte de uma carta (o nome e o id da Scryfall: a imagem art_crop vem pelo caminho das cartas, sf()).

Fronteira: a imagem chega em base64 e só fica se os primeiros bytes forem de WebP, JPEG ou PNG (nunca SVG nem HTML), até
MAX_BYTES e com MIN_PX..MAX_PX de lado (lidos do cabeçalho). Guarda-se em <dados>/avatars com um nome ao acaso (o nome
que o cliente mandou nunca conta) e serve-se em /avatars/<nome> com o tipo certo, nosniff e uma CSP que não deixa correr
nada. Um nome novo a cada mudança: a cache do browser pode ser «immutable».
Quem: «o:<dono>» (quem aloja / um perfil) e «g:<id do amigo>» (guests.friends). Nos payloads vão como "host" e
"guest:<id>" (o `who` da Taverna, das salas e das mesas) com o valor de view(): "/avatars/<nome>" ou {card, id}.
"""
import base64, binascii, hashlib, json, os, re, secrets, struct, time

import guests

DIR = None  # <dados>/avatars (server.py)
MAX_BYTES = 100_000
MIN_PX, MAX_PX = 32, 1024
NAME = re.compile(r"^[a-f0-9]{24}\.(webp|jpg|png)$")
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
CTYPE = {"webp": "image/webp", "jpg": "image/jpeg", "png": "image/png"}
CTRL = re.compile(r"[\x00-\x1f\x7f<>]")
PER = (10, 600)  # mudanças por pessoa: 10 em 10 minutos


def init(con):
    con.execute("CREATE TABLE IF NOT EXISTS avatars (who TEXT PRIMARY KEY, kind TEXT NOT NULL, v TEXT NOT NULL, ts REAL)")


def owner_key(owner):
    return f"o:{owner}"


def guest_key(fid):
    return f"g:{fid}"


def sniff(b):
    """Os bytes de uma imagem -> (extensão, largura, altura); ValueError se não for WebP, JPEG ou PNG estático."""
    if b[:8] == b"\x89PNG\r\n\x1a\n" and b[12:16] == b"IHDR" and len(b) >= 24:
        w, h = struct.unpack(">II", b[16:24])
        return "png", w, h
    if b[:3] == b"\xff\xd8\xff":
        i = 2
        while i + 9 < len(b):
            if b[i] != 0xFF:
                raise ValueError("JPEG estragado.")
            mk = b[i + 1]
            if mk in (0xD8, 0x01) or 0xD0 <= mk <= 0xD7:
                i += 2
                continue
            ln = struct.unpack(">H", b[i + 2:i + 4])[0]
            if 0xC0 <= mk <= 0xCF and mk not in (0xC4, 0xC8, 0xCC):
                h, w = struct.unpack(">HH", b[i + 5:i + 9])
                return "jpg", w, h
            i += 2 + ln
        raise ValueError("JPEG sem tamanho.")
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP" and len(b) >= 30:
        ch = b[12:16]
        if ch == b"VP8 " and b[23:26] == b"\x9d\x01\x2a":
            w, h = struct.unpack("<HH", b[26:30])
            return "webp", w & 0x3FFF, h & 0x3FFF
        if ch == b"VP8L" and b[20] == 0x2F:
            bits = struct.unpack("<I", b[21:25])[0]
            return "webp", (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
        if ch == b"VP8X":
            if b[20] & 0x02:
                raise ValueError("Imagens animadas não.")
            return "webp", 1 + int.from_bytes(b[24:27], "little"), 1 + int.from_bytes(b[27:30], "little")
    raise ValueError("Só imagens WebP, JPEG ou PNG.")


def view(kind, v):
    if kind == "img":
        return f"/avatars/{v}"
    if kind == "card":
        try:
            return json.loads(v)
        except ValueError:
            return None
    return None


def get(con, key):
    init(con)
    r = con.execute("SELECT kind, v FROM avatars WHERE who=?", (key,)).fetchone()
    return r and view(*r)


def many(con, owner):
    """{who: avatar} de quem aloja ("host") e dos amigos dele ("guest:<id>") que têm imagem."""
    init(con)
    guests.init(con)
    out = {}
    r = con.execute("SELECT kind, v FROM avatars WHERE who=?", (owner_key(owner),)).fetchone()
    if r:
        out["host"] = view(*r)
    for fid, k, v in con.execute("SELECT f.id, a.kind, a.v FROM avatars a JOIN friends f ON a.who = 'g:' || f.id WHERE f.owner=?", (owner,)):
        out[f"guest:{fid}"] = view(k, v)
    return {w: a for w, a in out.items() if a}


def _drop_file(con, v):
    """Apaga o ficheiro se já ninguém o usa (o mesmo ficheiro pode servir um perfil e o amigo ligado a ele)."""
    if NAME.match(v or "") and DIR and not con.execute("SELECT 1 FROM avatars WHERE kind='img' AND v=?", (v,)).fetchone():
        try:
            os.remove(os.path.join(DIR, v))
        except OSError:
            pass


def _set(con, key, kind, v):
    old = con.execute("SELECT kind, v FROM avatars WHERE who=?", (key,)).fetchone()
    con.execute("INSERT OR REPLACE INTO avatars (who, kind, v, ts) VALUES (?,?,?,?)", (key, kind, v, time.time()))
    if old and old[0] == "img" and old[1] != v:
        _drop_file(con, old[1])


def clear(con, key):
    init(con)
    old = con.execute("SELECT kind, v FROM avatars WHERE who=?", (key,)).fetchone()
    con.execute("DELETE FROM avatars WHERE who=?", (key,))
    if old and old[0] == "img":
        _drop_file(con, old[1])
    return bool(old)


def copy(con, src, dst):
    """O perfil deste Grimório que entra como amigo (guests.link_friend) leva a imagem dele (o mesmo ficheiro)."""
    init(con)
    r = con.execute("SELECT kind, v FROM avatars WHERE who=?", (src,)).fetchone()
    if r:
        _set(con, dst, *r)


def put(con, key, d, limit=True):
    """{img: base64} | {card, id} | {clear: true} -> (código, {avatar} | {erro})."""
    init(con)
    if not isinstance(d, dict):
        return 400, {"erro": "Pedido inválido."}
    if limit and guests.slow(("avatar", key), *PER):
        return 429, {"erro": "Mudaste a imagem muitas vezes: espera uns minutos."}
    if d.get("clear"):
        clear(con, key)
        return 200, {"avatar": None}
    if d.get("card") is not None:
        name, cid = CTRL.sub("", str(d.get("card") or "")).strip()[:150], str(d.get("id") or "").lower()
        if not name or not UUID.match(cid):
            return 400, {"erro": "Escolhe uma carta da lista."}
        _set(con, key, "card", json.dumps({"card": name, "id": cid}, ensure_ascii=False))
        return 200, {"avatar": get(con, key)}
    s = d.get("img")
    if not isinstance(s, str) or len(s) > MAX_BYTES * 4 // 3 + 8:
        return 400 if not isinstance(s, str) else 413, {"erro": "A imagem tem de ter até 100 KB."}
    try:
        b = base64.b64decode(s.split(",", 1)[1] if s.startswith("data:") else s, validate=True)
    except (binascii.Error, ValueError):
        return 400, {"erro": "Essa imagem não se lê."}
    if len(b) > MAX_BYTES:
        return 413, {"erro": "A imagem tem de ter até 100 KB."}
    try:
        ext, w, h = sniff(b)
    except (ValueError, struct.error, IndexError) as e:
        return 415, {"erro": str(e) if isinstance(e, ValueError) else "Essa imagem não se lê."}
    if not (MIN_PX <= w <= MAX_PX and MIN_PX <= h <= MAX_PX):
        return 400, {"erro": "A imagem tem de ter entre 32 e 1024 píxeis de lado."}
    old = con.execute("SELECT kind, v FROM avatars WHERE who=?", (key,)).fetchone()
    if old and old[0] == "img" and DIR:  # a mesma imagem (a app de um amigo manda-a a cada entrada): fica a que está
        try:
            with open(os.path.join(DIR, old[1]), "rb") as f:
                if hashlib.sha256(f.read()).digest() == hashlib.sha256(b).digest():
                    return 200, {"avatar": view(*old)}
        except OSError:
            pass
    os.makedirs(DIR, exist_ok=True)
    name = f"{secrets.token_hex(12)}.{ext}"
    tmp = os.path.join(DIR, name + ".tmp")
    with open(tmp, "wb") as f:
        f.write(b)
    os.replace(tmp, os.path.join(DIR, name))
    _set(con, key, "img", name)
    return 200, {"avatar": view("img", name)}


def export(con, key):
    """A minha imagem para levar ao Grimório de um amigo (server.remote_join): {img: base64} | {card, id} | None."""
    init(con)
    r = con.execute("SELECT kind, v FROM avatars WHERE who=?", (key,)).fetchone()
    if not r:
        return None
    if r[0] == "card":
        return view(*r)
    try:
        with open(os.path.join(DIR, r[1]), "rb") as f:
            return {"img": base64.b64encode(f.read()).decode()}
    except (OSError, TypeError):
        return None


def route(con, method, key, body):
    """GET -> {avatar}; POST {img | card+id | clear} (a pessoa `key`)."""
    if method == "GET":
        return 200, {"avatar": get(con, key)}
    if method == "POST":
        return put(con, key, body)
    return 404, {"erro": "rota desconhecida"}


def serve(h, name):
    """GET /avatars/<nome>: só nomes gerados aqui, com o tipo dos bytes e sem deixar correr nada."""
    if not NAME.match(name) or not DIR:
        return h.send(404, b"nao existe", "text/plain")
    path = os.path.join(DIR, name)
    if not os.path.isfile(path):
        return h.send(404, b"nao existe", "text/plain")
    etag = f'"{name.split(".")[0]}"'
    hd = {"ETag": etag, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; sandbox", "Cross-Origin-Resource-Policy": "cross-origin"}
    if h.headers.get("If-None-Match") == etag:
        return h.send(304, b"", CTYPE[name.rsplit(".", 1)[1]], hd)
    with open(path, "rb") as f:
        return h.send(200, f.read(), CTYPE[name.rsplit(".", 1)[1]], hd)


def test_png(w, h):
    """Um PNG a sério (para os selfchecks)."""
    import zlib
    raw = b"".join(b"\x00" + b"\x80\x40\x20" * w for _ in range(h))
    ck = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))  # noqa: E731
    return b"\x89PNG\r\n\x1a\n" + ck(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + ck(b"IDAT", zlib.compress(raw)) + ck(b"IEND", b"")


def selfcheck():
    """Validação dos bytes e da gravação (base temporária e pasta temporária)."""
    import sqlite3, tempfile
    global DIR
    keep, DIR = DIR, tempfile.mkdtemp(prefix="grim-av-")
    con = sqlite3.connect(":memory:")
    guests.init(con)
    con.execute("INSERT INTO friends (id, owner, name, token, created) VALUES ('aaaaaaaaaaaa', 'o', 'Rui', 'tok', 0)")

    png = test_png
    b64 = lambda b: base64.b64encode(b).decode()  # noqa: E731
    assert sniff(png(64, 48)) == ("png", 64, 48)
    assert sniff(b"RIFF\0\0\0\0WEBPVP8 " + b"\0" * 7 + b"\x9d\x01\x2a\x00\x01\x00\x01")[1:] == (256, 256)
    jpg = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xc0\x00\x11\x08\x00\x80\x00\xa0\x03" + b"\x00" * 20
    assert sniff(jpg) == ("jpg", 160, 128)
    k = guest_key("aaaaaaaaaaaa")
    assert put(con, k, {"img": b64(b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>")})[0] == 415
    assert put(con, k, {"img": b64(b"<html><body>x</body></html>" * 3)})[0] == 415
    assert put(con, k, {"img": "!!não é base64!!"})[0] == 400
    assert put(con, k, {"img": b64(png(8, 8))})[0] == 400  # pequena demais
    assert put(con, k, {"img": b64(b"\x89PNG\r\n\x1a\n" + b"\0" * (MAX_BYTES + 10))})[0] == 413
    st, j = put(con, k, {"img": "data:image/png;base64," + b64(png(64, 64))})
    assert st == 200 and NAME.match(j["avatar"].split("/")[-1]) and many(con, "o") == {"guest:aaaaaaaaaaaa": j["avatar"]}
    f1 = j["avatar"].split("/")[-1]
    assert put(con, k, {"img": b64(png(64, 64))})[1]["avatar"] == j["avatar"]  # a mesma imagem não se grava outra vez
    assert put(con, k, {"card": "Llanowar <b>Elves", "id": "nada"})[0] == 400
    st, j = put(con, owner_key("o"), {"card": "Llanowar Elves", "id": "6A0B230B-D391-4998-A3F7-7B158A0EC2CD"})
    assert st == 200 and j["avatar"] == {"card": "Llanowar Elves", "id": "6a0b230b-d391-4998-a3f7-7b158a0ec2cd"}
    copy(con, k, guest_key("bbbbbbbbbbbb"))
    assert put(con, k, {"clear": True})[1] == {"avatar": None} and os.path.isfile(os.path.join(DIR, f1))  # o outro ainda a usa
    assert clear(con, guest_key("bbbbbbbbbbbb")) and not os.path.exists(os.path.join(DIR, f1))
    assert set(many(con, "o")) == {"host"}
    import tournament  # no torneio: as pessoas por detrás dos decks (sala: `by`; deck de um amigo: o dono do deck)
    con.execute("CREATE TABLE decks (id TEXT PRIMARY KEY, name TEXT, format TEXT, body TEXT, updated REAL, owner TEXT, deleted REAL)")
    con.execute("INSERT INTO decks VALUES ('dr', 'D', 'modern', ?, 0, 'o', NULL)", (json.dumps({"friend": "aaaaaaaaaaaa"}),))
    put(con, k, {"card": "Forest", "id": "6a0b230b-d391-4998-a3f7-7b158a0ec2ce"}, limit=False)
    st = {"players": [{"src": "meus", "ref": "x"}, {"src": "meus", "ref": "dr", "fr": "Rui"}, {"src": "meta", "ref": "m"}, {"by": "host"}]}
    assert set(tournament.people_avs(con, "o", st)) == {"1", "3"}
    guests._HITS.clear()
    for _ in range(PER[0]):
        put(con, k, {"clear": True})
    assert put(con, k, {"clear": True})[0] == 429  # limite de mudanças
    guests._HITS.clear()
    DIR = keep
    print("selfcheck avatars ok")
