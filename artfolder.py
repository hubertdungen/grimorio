"""Imagens próprias a partir de uma pasta na net (Biblioteca/Construir › Imagem própria › pasta).

listing(url) → [{"name": nome do ficheiro, "url": link https da imagem}] para:
  - pasta pública do Google Drive (vista simples embeddedfolderview: nomes e ids dos ficheiros);
  - pasta do GitHub (github.com/dono/repo/tree/ramo/caminho → API de conteúdos);
  - qualquer outra página: links e imagens que acabam em .jpg/.png/.webp/.gif (índices de pastas, galerias simples).
fetch(url) → (bytes, content-type) de uma imagem, para o browser a comprimir e guardar (POST /api/arts).
Só https e só endereços públicos (também depois de redireções): o servidor não serve para espreitar a rede de casa.
"""
import html, ipaddress, json, os, re, socket, urllib.parse, urllib.request

IMG = re.compile(r"\.(jpe?g|png|webp|gif)$", re.I)
UA = {"User-Agent": "Mozilla/5.0 (Grimorio; imagens próprias)"}


def public(url):
    u = urllib.parse.urlsplit(url)
    if u.scheme != "https" or not u.hostname:
        raise ValueError("O link tem de começar por https://")
    # ponytail: verifica o DNS uma vez antes do pedido (rebinding fica de fora); chega para uma app pessoal com login
    for *_, sa in socket.getaddrinfo(u.hostname, u.port or 443):
        if not ipaddress.ip_address(sa[0]).is_global:
            raise ValueError("Esse endereço não é público.")


class _Redirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        public(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_open = urllib.request.build_opener(_Redirect).open


def get(url, limit, timeout=20):
    public(url)
    with _open(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        body = r.read(limit + 1)
        if len(body) > limit:
            raise ValueError("O ficheiro é grande demais.")
        return body, (r.headers.get("Content-Type") or "").split(";")[0].strip().lower(), r.geturl()


def parse_index(page, base):
    """Links e imagens de uma página: {url absoluto: nome do ficheiro}, só os que acabam em extensão de imagem."""
    out = {}
    for raw in re.findall(r"""(?:href|src)\s*=\s*["']([^"']+)["']""", page, re.I):
        u = urllib.parse.urljoin(base, html.unescape(raw))
        path = urllib.parse.urlsplit(u).path
        if u.startswith("https://") and IMG.search(path):
            out.setdefault(u, urllib.parse.unquote(os.path.basename(path)))
    return out


def listing(url):
    url = url.strip()
    m = re.search(r"drive\.google\.com/(?:drive/(?:u/\d+/)?folders/|open\?id=|embeddedfolderview\?id=)([\w-]{10,})", url)
    if m:
        page = get(f"https://drive.google.com/embeddedfolderview?id={m.group(1)}", 4_000_000)[0].decode("utf-8", "replace")
        files = re.findall(r'id="entry-([\w-]{10,})".*?class="flip-entry-title">([^<]+)<', page, re.S)
        if not files:
            raise ValueError("Não vi ficheiros: a pasta do Drive tem de estar partilhada com «qualquer pessoa com o link».")
        return [{"name": html.unescape(t).strip(), "url": f"https://drive.google.com/thumbnail?id={i}&sz=w1000"} for i, t in files][:800]
    m = re.match(r"https://github\.com/([^/]+)/([^/]+)/tree/([^/]+)/?(.*)$", url)
    if m:
        o, r, ref, path = m.groups()
        items = json.loads(get(f"https://api.github.com/repos/{o}/{r}/contents/{path}?ref={ref}", 4_000_000)[0])
        return [{"name": x["name"], "url": x["download_url"]} for x in items if x.get("type") == "file" and IMG.search(x["name"])][:800]
    body, ctype, final = get(url, 4_000_000)
    if ctype.startswith("image/"):
        return [{"name": urllib.parse.unquote(os.path.basename(urllib.parse.urlsplit(final).path)), "url": url}]
    found = parse_index(body.decode("utf-8", "replace"), final)
    if not found:
        raise ValueError("Não encontrei imagens nesse link. Funciona com pastas públicas do Google Drive, pastas do GitHub e páginas com links para as imagens; para o resto, descarrega a pasta e escolhe-a no computador.")
    return [{"name": n, "url": u} for u, n in found.items()][:800]


def fetch(url):
    body, ctype, _ = get(url, 15_000_000, timeout=30)
    if not ctype.startswith("image/"):
        raise ValueError("Esse link não é uma imagem.")
    return body, ctype


def _safe(n):
    return re.sub(r'[\\/:*?"<>|]+', "", str(n)).strip()[:80] or "carta"


def proxies_zip(items, arts_dir, list_txt="", per_copy=False):
    """ZIP para gráficas de proxies: items = [{"name", "q", "url", "back", "fallback"}] (url = https:// ou arts/<ficheiro>;
    back = verso das cartas de duas faces; fallback = a arte normal, se a imagem própria não vier — há sites que recusam
    pedidos que não venham de um browser). Um ficheiro por grupo («Island (x4).png») ou um por cópia; lista.txt com as
    edições e faltam.txt com as imagens que tiveram de ser trocadas. Devolve (bytes do zip, nomes das cartas trocadas)."""
    import io, zipfile
    buf, cache, k, missed = io.BytesIO(), {}, 0, []

    def load(url):
        if url not in cache:
            m = re.fullmatch(r"arts/([a-f0-9]{20}\.(?:jpg|png|webp|gif))", url)
            if m:
                with open(os.path.join(arts_dir, m.group(1)), "rb") as f:
                    cache[url] = (f.read(), os.path.splitext(m.group(1))[1])
            else:
                body, ctype = fetch(url)
                cache[url] = (body, "." + {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif"}.get(ctype, "jpg"))
        return cache[url]
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:  # imagens já vêm comprimidas
        if list_txt:
            z.writestr("lista.txt", list_txt)
        for it in items[:400]:
            k += 1
            q = max(1, min(int(it.get("q") or 1), 99))
            for side, url in (("", it.get("url")), (" - verso", it.get("back"))):
                if not url:
                    continue
                try:
                    body, ext = load(url)
                except Exception:  # imagem própria que o site recusa: fica a arte normal (ou nada, se também falhar)
                    missed.append(str(it.get("name")))
                    try:
                        if side or not it.get("fallback"):
                            continue
                        body, ext = load(it["fallback"])
                    except Exception:
                        continue
                base = f"{k:03d} {_safe(it.get('name'))}"
                names = [f"{base}{side} ({i + 1}){ext}" for i in range(q)] if per_copy and q > 1 else [f"{base}{side}{f' (x{q})' if q > 1 else ''}{ext}"]
                for n in names:
                    z.writestr(n, body)
        if missed:
            z.writestr("faltam.txt", "Imagens próprias que o site não deixou descarregar (ficou a arte normal):\n" + "\n".join(sorted(set(missed))) + "\n")
    return buf.getvalue(), sorted(set(missed))


def selfcheck():
    page = '<a href="Island%20(Unhinged).jpg">x</a><img src="/img/Forest-2.PNG"><a href="notas.txt">n</a><a href="https://cdn.x.com/a/Swamp.webp?v=2">s</a>'
    got = parse_index(page, "https://exemplo.pt/artes/")
    assert got == {"https://exemplo.pt/artes/Island%20(Unhinged).jpg": "Island (Unhinged).jpg", "https://exemplo.pt/img/Forest-2.PNG": "Forest-2.PNG",
                   "https://cdn.x.com/a/Swamp.webp?v=2": "Swamp.webp"}, got
    for bad in ("http://exemplo.pt/x.jpg", "https://127.0.0.1/x.jpg", "https://10.0.0.5/x.jpg", "https://[::1]/x.jpg"):
        try:
            public(bad)
        except ValueError:
            continue
        raise AssertionError(f"devia recusar {bad}")
    import tempfile, zipfile, io
    with tempfile.TemporaryDirectory() as d:
        open(os.path.join(d, "0123456789abcdef0123.webp"), "wb").write(b"img")
        z = zipfile.ZipFile(io.BytesIO(proxies_zip([{"name": "Island", "q": 3, "url": "arts/0123456789abcdef0123.webp"}], d, "3 Island", per_copy=True)[0]))
        assert sorted(z.namelist()) == ["001 Island (1).webp", "001 Island (2).webp", "001 Island (3).webp", "lista.txt"], z.namelist()
        z = zipfile.ZipFile(io.BytesIO(proxies_zip([{"name": "A/B: C", "q": 4, "url": "arts/0123456789abcdef0123.webp"}], d)[0]))
        assert z.namelist() == ["001 AB C (x4).webp"], z.namelist()
        data, missed = proxies_zip([{"name": "X", "q": 1, "url": "arts/ffffffffffffffffffff.png", "fallback": "arts/0123456789abcdef0123.webp"}], d)
        z = zipfile.ZipFile(io.BytesIO(data))
        assert missed == ["X"] and sorted(z.namelist()) == ["001 X.webp", "faltam.txt"], (missed, z.namelist())
    return True


if __name__ == "__main__":
    print("selfcheck ok" if selfcheck() else "falhou")
