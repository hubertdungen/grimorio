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
    return True


if __name__ == "__main__":
    print("selfcheck ok" if selfcheck() else "falhou")
