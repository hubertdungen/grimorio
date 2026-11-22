"""Alter arts (🎨 Arte › ✨ Criar alter art): gerar imagens de cartas pelo servidor, com a chave do utilizador.

Fornecedores: «openai» (Images API: generations / edits com máscara e imagens de referência), «gemini» (generateContent
com imagem de saída), «local» (Automatic1111/Forge WebUI ou ComfyUI no PC do utilizador) e «mock» (testes, só com
GRIMORIO_IMG_MOCK=1). As chaves são as do Assistente IA (ia.json, ia.load) e nunca voltam ao browser.
Pedido: {provider, prompt, n (1-4), size ("1024x1536"|"1536x1024"), quality, model, image, mask, refs} com as imagens em
data URL (o browser prepara a carta, a máscara e as referências); resposta: {images: [data URL], model, cost}.
"""
import base64, binascii, json, os, random, re, struct, threading, time, urllib.error, urllib.parse, urllib.request, uuid, zlib

import ia

OPENAI = "https://api.openai.com/v1"
GEMINI = "https://generativelanguage.googleapis.com/v1beta"
# preço indicativo por imagem em USD (1024×1536 na OpenAI); o browser mostra-o antes de gerar
PROVIDERS = {
    "openai": {"model": "gpt-image-1", "cost": {"low": 0.016, "medium": 0.063, "high": 0.25}},
    "gemini": {"model": "gemini-2.5-flash-image", "cost": {"medium": 0.039}},
    "local": {"model": "", "cost": {"medium": 0}},
    "mock": {"model": "mock", "cost": {"medium": 0}},
}
SIZES = {"1024x1536": (1024, 1536), "1536x1024": (1536, 1024)}
LOCAL_SIZES = {"1024x1536": (832, 1216), "1536x1024": (1216, 832)}  # o tamanho natural do SDXL; o SD 1.5 também aguenta
NEGATIVE = "text, letters, words, watermark, signature, logo, blurry, lowres, deformed"
SAFETY = "O fornecedor recusou a imagem por segurança (conteúdo). Muda o texto do pedido e tenta outra vez."


def mock_on():
    return os.environ.get("GRIMORIO_IMG_MOCK") == "1"


def config(data_dir):
    c = ia.load(data_dir)
    loc = c.get("imgLocal") or {}
    ids = [k for k in PROVIDERS if k != "mock" or mock_on()]
    return {"providers": [{"id": k, "model": PROVIDERS[k]["model"], "cost": PROVIDERS[k]["cost"],
                           "hasKey": bool(loc.get("url")) if k == "local" else k == "mock" or bool(c["keys"].get(k))} for k in ids],
            "local": {"url": loc.get("url", ""), "kind": loc.get("kind", "a1111")}}


def _img(d, limit=12_000_000):
    m = re.fullmatch(r"data:(image/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)", str(d or ""), re.S)
    if not m:
        raise ValueError("Imagem inválida (tem de ser png, jpg ou webp).")
    try:
        b = base64.b64decode(m.group(2), validate=False)
    except binascii.Error:
        raise ValueError("Imagem inválida.")
    if not 0 < len(b) <= limit:
        raise ValueError("Imagem grande demais.")
    return b, m.group(1)


def _url(b, mime="image/png"):
    return f"data:{mime};base64,{base64.b64encode(b).decode()}"


def _multipart(fields, files):
    bd, out = uuid.uuid4().hex, []
    for k, v in fields:
        out.append(f'--{bd}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    for k, name, mime, data in files:
        out += [f'--{bd}\r\nContent-Disposition: form-data; name="{k}"; filename="{name}"\r\nContent-Type: {mime}\r\n\r\n'.encode(), data, b"\r\n"]
    out.append(f"--{bd}--\r\n".encode())
    return b"".join(out), f"multipart/form-data; boundary={bd}"


def _req(url, body=None, headers=None, ctype="application/json", timeout=300):
    data = body if isinstance(body, bytes) or body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers={**({"Content-Type": ctype} if data is not None else {}), **(headers or {})},
                                 method="POST" if data is not None else "GET")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read(80_000_000)
        return raw if not (r.headers.get("Content-Type") or "").startswith("application/json") else json.loads(raw)


def _err_body(e):
    try:
        j = json.loads(e.read(200_000) or b"{}")
    except ValueError:
        return "", ""
    er = j.get("error") if isinstance(j, dict) else None
    if isinstance(er, dict):
        return str(er.get("message") or "")[:300], str(er.get("code") or er.get("status") or er.get("type") or "")
    return str(er or "")[:300], ""


def _openai_err(e):
    msg, code = _err_body(e)
    low = (msg + " " + code).lower()
    if "moderation" in low or "safety" in low or "content_policy" in low:
        return SAFETY
    if e.code == 401:
        return "Chave inválida (OpenAI)."
    if "insufficient_quota" in low or "billing" in low:
        return "Sem saldo na conta da OpenAI (a API paga-se à parte do plano do ChatGPT)."
    if e.code == 429:
        return "Limite de pedidos da OpenAI atingido; tenta daqui a pouco."
    if e.code == 403 and "verif" in low:
        return "A OpenAI pede que a organização seja verificada para usar este modelo (platform.openai.com › Settings › Organization)."
    return f"A OpenAI respondeu com erro {e.code}: {msg}" if msg else f"A OpenAI respondeu com erro {e.code}."


def _openai(key, p):
    model, (w, h) = p["model"], SIZES[p["size"]]
    imgs = ([p["image"]] if p["image"] else []) + p["refs"]
    hd = {"Authorization": f"Bearer {key}"}
    fields = [("model", model), ("prompt", p["prompt"]), ("n", p["n"]), ("size", f"{w}x{h}"), ("quality", p["quality"])]
    try:
        if imgs:  # editar a carta (máscara sobre a caixa da arte) e/ou partir de imagens de referência
            files = [("image[]", f"ref{k}.{m.split('/')[1]}", m, b) for k, (b, m) in enumerate(imgs)]
            if p["mask"] and p["image"]:
                files.append(("mask", "mask.png", "image/png", p["mask"][0]))
            body, ct = _multipart(fields, files)
            r = _req(f"{OPENAI}/images/edits", body, hd, ct)
        else:
            r = _req(f"{OPENAI}/images/generations", dict(fields), hd)
    except urllib.error.HTTPError as e:
        raise RuntimeError(_openai_err(e))
    out = [base64.b64decode(x["b64_json"]) for x in r.get("data") or [] if x.get("b64_json")]
    if not out:
        raise RuntimeError("A OpenAI não devolveu imagens.")
    return out


def _gemini(key, p):
    w, h = SIZES[p["size"]]
    parts = [{"text": p["prompt"]}] + [{"inline_data": {"mime_type": m, "data": base64.b64encode(b).decode()}}
                                       for b, m in ([p["image"]] if p["image"] else []) + p["refs"]]
    body = {"contents": [{"parts": parts}], "generationConfig": {"responseModalities": ["TEXT", "IMAGE"],
                                                                  "imageConfig": {"aspectRatio": "2:3" if h > w else "3:2"}}}
    out = []
    for _ in range(p["n"]):  # uma imagem por pedido
        try:
            r = _req(f"{GEMINI}/models/{p['model']}:generateContent", body, {"x-goog-api-key": key})
        except urllib.error.HTTPError as e:
            msg, code = _err_body(e)
            if e.code == 400 and "api key" in msg.lower() or e.code in (401, 403) and "key" in msg.lower():
                raise RuntimeError("Chave inválida (Google Gemini).")
            if e.code == 429 or code == "RESOURCE_EXHAUSTED":
                raise RuntimeError("Quota do Gemini esgotada (a geração de imagens pode precisar de faturação ativa no Google AI Studio).")
            raise RuntimeError(f"O Gemini respondeu com erro {e.code}: {msg}" if msg else f"O Gemini respondeu com erro {e.code}.")
        if (r.get("promptFeedback") or {}).get("blockReason"):
            raise RuntimeError(SAFETY)
        cand = (r.get("candidates") or [{}])[0]
        got = [base64.b64decode(x["inlineData"]["data"]) for x in (cand.get("content") or {}).get("parts") or [] if (x.get("inlineData") or {}).get("data")]
        if not got:
            if re.search(r"SAFETY|PROHIBITED|BLOCKLIST|RECITATION", str(cand.get("finishReason") or "")):
                raise RuntimeError(SAFETY)
            txt = " ".join(x.get("text", "") for x in (cand.get("content") or {}).get("parts") or [])[:200]
            raise RuntimeError("O Gemini não devolveu imagem." + (f" Disse: {txt}" if txt else ""))
        out += got[:1]
    return out


def _a1111(base, p):
    w, h = LOCAL_SIZES[p["size"]]
    body = {"prompt": p["prompt"], "negative_prompt": NEGATIVE, "width": w, "height": h, "batch_size": p["n"], "steps": 28, "cfg_scale": 6.5}
    if p["model"]:  # o checkpoint escolhido no diálogo; sem ele, fica o que está carregado no A1111/Forge
        body["override_settings"] = {"sd_model_checkpoint": p["model"]}
    if p["image"]:
        body.update(init_images=[base64.b64encode(p["image"][0]).decode()], denoising_strength=0.95 if p["mask"] else 0.6)
        if p["mask"]:  # branco = pintar de novo (a caixa da arte)
            body.update(mask=base64.b64encode(p["mask"][0]).decode(), inpainting_fill=1, inpaint_full_res=False, mask_blur=4)
    r = _req(f"{base}/sdapi/v1/{'img2img' if p['image'] else 'txt2img'}", body, timeout=900)
    return [base64.b64decode(x.split(",", 1)[-1]) for x in r.get("images") or []][:p["n"]]


def _comfy(base, p):
    w, h = LOCAL_SIZES[p["size"]]
    info = _req(f"{base}/object_info/CheckpointLoaderSimple", timeout=30)
    cks = info["CheckpointLoaderSimple"]["input"]["required"]["ckpt_name"][0]
    if not cks:
        raise RuntimeError("O ComfyUI não tem nenhum modelo (checkpoint) instalado.")
    g = {"1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": p["model"] if p["model"] in cks else cks[0]}},
         "2": {"class_type": "CLIPTextEncode", "inputs": {"text": p["prompt"], "clip": ["1", 1]}},
         "3": {"class_type": "CLIPTextEncode", "inputs": {"text": NEGATIVE, "clip": ["1", 1]}},
         "4": {"class_type": "EmptyLatentImage", "inputs": {"width": w, "height": h, "batch_size": p["n"]}},
         "5": {"class_type": "KSampler", "inputs": {"model": ["1", 0], "positive": ["2", 0], "negative": ["3", 0], "latent_image": ["4", 0],
                                                    "seed": random.randrange(2**31), "steps": 28, "cfg": 6.5, "sampler_name": "euler", "scheduler": "normal", "denoise": 1.0}},
         "6": {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["1", 2]}},
         "7": {"class_type": "SaveImage", "inputs": {"images": ["6", 0], "filename_prefix": "grimorio-alter"}}}
    if p["image"]:  # a carta com a caixa da arte transparente: o LoadImage dá a máscara pelo alfa
        body, ct = _multipart([("overwrite", "true")], [("image", f"grimorio-{uuid.uuid4().hex[:8]}.png", "image/png", p["image"][0])])
        up = _req(f"{base}/upload/image", body, ctype=ct, timeout=60)
        name = f"{up['subfolder']}/{up['name']}" if up.get("subfolder") else up["name"]
        g["8"] = {"class_type": "LoadImage", "inputs": {"image": name}}
        g["9"] = {"class_type": "VAEEncodeForInpaint", "inputs": {"pixels": ["8", 0], "vae": ["1", 2], "mask": ["8", 1], "grow_mask_by": 8}}
        g["4"] = {"class_type": "RepeatLatentBatch", "inputs": {"samples": ["9", 0], "amount": p["n"]}}
    pid = _req(f"{base}/prompt", {"prompt": g, "client_id": "grimorio"}, timeout=30)["prompt_id"]
    for _ in range(600):  # até 15 minutos
        hist = _req(f"{base}/history/{pid}", timeout=30).get(pid)
        if hist and hist.get("outputs"):
            ims = hist["outputs"].get("7", {}).get("images") or []
            return [_req(f"{base}/view?" + urllib.parse.urlencode({k: x.get(k, "") for k in ("filename", "subfolder", "type")}), timeout=60) for x in ims][:p["n"]]
        if hist and (hist.get("status") or {}).get("status_str") == "error":
            raise RuntimeError("O ComfyUI deu erro a gerar (vê a consola dele).")
        time.sleep(1.5)
    raise RuntimeError("O ComfyUI demorou demasiado.")


def png(w, h, k=0):
    """PNG de teste (gradiente com cor por variação), só stdlib: o fornecedor «mock» e o selfcheck."""
    c = [(200, 60, 60), (60, 160, 90), (60, 90, 200), (190, 150, 40)][k % 4]
    rows = b"".join(b"\x00" + bytes((min(255, c[0] + y * 50 // h), c[1], min(255, c[2] + y * 40 // h))) * w for y in range(h))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)  # noqa: E731
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows, 6)) + chunk(b"IEND", b"")


def generate(data_dir, payload):
    prov = payload.get("provider")
    if prov not in PROVIDERS or prov == "mock" and not mock_on():
        raise ValueError("Escolhe um fornecedor de imagens.")
    prompt = str(payload.get("prompt") or "").strip()
    if not prompt:
        raise ValueError("O pedido (prompt) está vazio.")
    size = payload.get("size") if payload.get("size") in SIZES else "1024x1536"
    model = str(payload.get("model") or PROVIDERS[prov]["model"]).strip()
    if model and not re.fullmatch(r"[\w.\-:/ ]{1,120}", model):
        raise ValueError("Nome de modelo inválido.")
    refs = payload.get("refs") or []
    if len(refs) > 4:
        raise ValueError("No máximo 4 imagens de referência.")
    p = {"prompt": prompt[:30000], "n": max(1, min(int(payload.get("n") or 1), 4)), "size": size, "model": model,
         "quality": payload.get("quality") if payload.get("quality") in ("low", "medium", "high") else "medium",
         "image": _img(payload["image"]) if payload.get("image") else None, "mask": _img(payload["mask"]) if payload.get("mask") else None,
         "refs": [_img(r) for r in refs]}
    c = ia.load(data_dir)
    if prov == "mock":
        if "#erro" in prompt:
            raise RuntimeError(SAFETY)
        out = [png(*SIZES[size], k) for k in range(p["n"])]
    elif prov == "local":
        loc = c.get("imgLocal") or {}
        if not loc.get("url"):
            raise ValueError("Falta o endereço do gerador local (Definições › IA).")
        base = loc["url"].rstrip("/")
        try:
            out = (_comfy if loc.get("kind") == "comfy" else _a1111)(base, p)
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"O gerador local respondeu com erro {e.code}" + (" (a API está ligada? No A1111/Forge arranca com --api)." if e.code == 404 else "."))
        except (urllib.error.URLError, OSError):
            raise RuntimeError(f"O gerador local não responde em {base}. O PC está ligado e o programa aberto, com a API ativa (--api no A1111/Forge, --listen para aceitar ligações da rede)?")
        except (KeyError, IndexError, TypeError, ValueError):
            raise RuntimeError("O gerador local respondeu num formato inesperado.")
    else:
        key = c["keys"].get(prov)
        if not key:
            raise ValueError("Falta a chave deste fornecedor (Definições › IA).")
        try:
            out = (_openai if prov == "openai" else _gemini)(key, p)
        except urllib.error.URLError:
            raise RuntimeError("Não consegui ligar ao fornecedor de imagens.")
        except (KeyError, IndexError, TypeError, ValueError, binascii.Error):
            raise RuntimeError("A resposta do fornecedor veio num formato inesperado.")
    if not out:
        raise RuntimeError("O gerador não devolveu imagens.")
    mime = lambda b: "image/jpeg" if b[:2] == b"\xff\xd8" else "image/webp" if b[8:12] == b"WEBP" else "image/png"  # noqa: E731
    cost = PROVIDERS[prov]["cost"].get(p["quality"], next(iter(PROVIDERS[prov]["cost"].values())))
    return {"images": [_url(b, mime(b)) for b in out], "model": f"{prov} · {model}" if model else prov, "cost": round(cost * len(out), 3)}


# Gerar demora (1–3 min em qualidade alta): o túnel da Cloudflare corta pedidos com mais de 100 s («502»). Por isso o
# browser arranca um trabalho e vai perguntando por ele; o resultado fica 1 h em memória.
JOBS, _JL = {}, threading.Lock()


def start(data_dir, payload):
    jid = uuid.uuid4().hex
    with _JL:
        for k in [k for k, v in JOBS.items() if time.time() - v["t"] > 3600]:
            del JOBS[k]
        JOBS[jid] = {"t": time.time(), "state": "running"}

    def run():
        try:
            out = {"state": "done", **generate(data_dir, payload)}
        except ValueError as e:
            out = {"state": "error", "erro": str(e), "code": 400}
        except Exception as e:  # RuntimeError (fornecedor) e o resto: o trabalho nunca fica «a correr» para sempre
            out = {"state": "error", "erro": str(e) or e.__class__.__name__, "code": 502}
        with _JL:
            JOBS[jid] = {"t": time.time(), **out}
    threading.Thread(target=run, daemon=True).start()
    return jid


def job(jid):
    with _JL:
        j = JOBS.get(jid)
        return {k: v for k, v in j.items() if k != "t"} if j else None


def selfcheck():
    """Sem rede: um servidor falso faz de OpenAI, Gemini, A1111 e ComfyUI (as chaves são de mentira)."""
    import tempfile, threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    seen = []

    class Fake(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def reply(self, obj, code=200, ctype="application/json"):
            b = obj if isinstance(obj, bytes) else json.dumps(obj).encode()
            self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)

        def do_GET(self):
            if self.path.startswith("/object_info/"):
                return self.reply({"CheckpointLoaderSimple": {"input": {"required": {"ckpt_name": [["sdxl.safetensors"]]}}}})
            if self.path.startswith("/history/"):
                return self.reply({"p1": {"outputs": {"7": {"images": [{"filename": "a.png", "subfolder": "", "type": "output"}]}}}})
            if self.path.startswith("/view?"):
                return self.reply(png(8, 12), ctype="image/png")
            self.reply({}, 404)

        def do_POST(self):
            body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
            seen.append((self.path, self.headers.get("Content-Type", ""), self.headers.get("Authorization") or self.headers.get("x-goog-api-key"), body))
            b64 = base64.b64encode(png(4, 6)).decode()
            if self.path.endswith("/images/generations") or self.path.endswith("/images/edits"):
                if b"#bloquear" in body:
                    return self.reply({"error": {"message": "Your request was rejected by the safety system.", "code": "moderation_blocked"}}, 400)
                if self.headers.get("Authorization") == "Bearer sk-mau":
                    return self.reply({"error": {"message": "Incorrect API key", "code": "invalid_api_key"}}, 401)
                return self.reply({"data": [{"b64_json": b64}] * 2})
            if ":generateContent" in self.path:
                if b"#bloquear" in body:
                    return self.reply({"candidates": [{"finishReason": "IMAGE_SAFETY", "content": {"parts": []}}]})
                return self.reply({"candidates": [{"content": {"parts": [{"text": "ok"}, {"inlineData": {"mimeType": "image/png", "data": b64}}]}}]})
            if self.path.startswith("/sdapi/v1/"):
                return self.reply({"images": [b64, b64]})
            if self.path == "/upload/image":
                return self.reply({"name": "x.png", "subfolder": "", "type": "input"})
            if self.path == "/prompt":
                return self.reply({"prompt_id": "p1"})
            self.reply({}, 404)

    global OPENAI, GEMINI
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    fake = f"http://127.0.0.1:{srv.server_address[1]}"
    old = OPENAI, GEMINI
    OPENAI, GEMINI = fake + "/v1", fake + "/v1beta"
    tmp = tempfile.mkdtemp(prefix="grim-img-")
    try:
        ia.save(tmp, {"keys": {"openai": "sk-test", "gemini": "g-test"}})
        card, mask = _url(png(10, 14)), _url(png(10, 14))
        assert [x["id"] for x in config(tmp)["providers"]] == ["openai", "gemini", "local"] or mock_on()
        assert "sk-test" not in json.dumps(config(tmp))
        r = generate(tmp, {"provider": "openai", "prompt": "a dragon", "n": 2})
        assert len(r["images"]) == 2 and r["images"][0].startswith("data:image/png;base64,") and r["cost"] == 0.126, r["cost"]
        assert seen[-1][0] == "/v1/images/generations" and seen[-1][2] == "Bearer sk-test" and json.loads(seen[-1][3])["size"] == "1024x1536"
        generate(tmp, {"provider": "openai", "prompt": "edit", "image": card, "mask": mask, "refs": [card], "quality": "high", "size": "1536x1024"})
        path, ct, _, body = seen[-1]
        assert path == "/v1/images/edits" and ct.startswith("multipart/form-data") and body.count(b'name="image[]"') == 2 and b'name="mask"' in body and b"1536x1024" in body
        for prov, msg in (("openai", "segurança"), ("gemini", "segurança")):
            try:
                generate(tmp, {"provider": prov, "prompt": "#bloquear"})
                raise AssertionError("devia recusar")
            except RuntimeError as e:
                assert msg in str(e), e
        ia.save(tmp, {"keys": {"openai": "sk-mau"}})
        try:
            generate(tmp, {"provider": "openai", "prompt": "x"})
            raise AssertionError("chave má")
        except RuntimeError as e:
            assert "Chave inválida" in str(e)
        r = generate(tmp, {"provider": "gemini", "prompt": "a dragon", "n": 2, "refs": [card]})
        assert len(r["images"]) == 2 and seen[-1][2] == "g-test" and ":generateContent" in seen[-1][0]
        assert json.loads(seen[-1][3])["contents"][0]["parts"][1]["inline_data"]["mime_type"] == "image/png"
        try:
            generate(tmp, {"provider": "local", "prompt": "x"})
            raise AssertionError("sem endereço")
        except ValueError:
            pass
        ia.save(tmp, {"imgLocal": {"url": fake, "kind": "a1111"}})
        r = generate(tmp, {"provider": "local", "prompt": "elf", "n": 2, "image": card, "mask": mask})
        assert len(r["images"]) == 2 and seen[-1][0] == "/sdapi/v1/img2img" and "mask" in json.loads(seen[-1][3]) and r["cost"] == 0
        ia.save(tmp, {"imgLocal": {"url": fake, "kind": "comfy"}})
        r = generate(tmp, {"provider": "local", "prompt": "elf", "image": card})
        g = json.loads(seen[-1][3])["prompt"]
        assert len(r["images"]) == 1 and g["9"]["class_type"] == "VAEEncodeForInpaint" and g["1"]["inputs"]["ckpt_name"] == "sdxl.safetensors"
        ia.save(tmp, {"imgLocal": {"url": "http://127.0.0.1:9", "kind": "a1111"}})  # porta fechada
        try:
            generate(tmp, {"provider": "local", "prompt": "x"})
            raise AssertionError("devia falhar")
        except RuntimeError as e:
            assert "não responde" in str(e), e
        for bad in ({"provider": "mock", "prompt": "x"} if not mock_on() else {"provider": "nada", "prompt": "x"}, {"provider": "openai", "prompt": " "},
                    {"provider": "openai", "prompt": "x", "image": "data:text/html;base64,AAAA"}, {"provider": "openai", "prompt": "x", "model": "a;rm -rf"}):
            try:
                generate(tmp, bad)
                raise AssertionError(bad)
            except ValueError:
                pass
        assert png(3, 2)[:8] == b"\x89PNG\r\n\x1a\n"
    finally:
        OPENAI, GEMINI = old
        srv.shutdown()


if __name__ == "__main__":
    selfcheck()
    print("selfcheck ok")
