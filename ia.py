"""Assistente de IA do Grimório (extra opcional): sugerir e reorganizar decks.

Fornecedores: os gratuitos falam a API compatível com OpenAI (Gemini, Groq, OpenRouter
com modelos :free, Ollama local); o Claude (pago) usa a Messages API da Anthropic.
Stdlib apenas (o host não tem pip). A chave fica em <data>/ia.json (0600) e nunca
vai para o browser. A resposta é JSON com o esquema SCHEMA; o browser valida cada
carta contra a base antes de a mostrar.
"""
import json, os, re, time, urllib.error, urllib.request

PROVIDERS = {
    "gemini": {"kind": "openai", "base": "https://generativelanguage.googleapis.com/v1beta/openai", "model": "gemini-2.5-flash",
               "label": "Google Gemini (grátis, com limite diário)", "keyUrl": "https://aistudio.google.com/apikey"},
    "groq": {"kind": "openai", "base": "https://api.groq.com/openai/v1", "model": "llama-3.3-70b-versatile",
             "label": "Groq (grátis, com limite por minuto)", "keyUrl": "https://console.groq.com/keys"},
    "openrouter": {"kind": "openai", "base": "https://openrouter.ai/api/v1", "model": "meta-llama/llama-3.3-70b-instruct:free",
                   "label": "OpenRouter (modelos :free)", "keyUrl": "https://openrouter.ai/keys"},
    "ollama": {"kind": "openai", "base": "http://127.0.0.1:11434/v1", "model": "llama3.1",
               "label": "Ollama local (grátis, precisa de máquina com RAM)", "nokey": True},
    "openai": {"kind": "openai", "base": "https://api.openai.com/v1", "model": "gpt-5-mini",
               "label": "OpenAI GPT (pago)", "keyUrl": "https://platform.openai.com/api-keys"},
    "deepseek": {"kind": "openai", "base": "https://api.deepseek.com", "model": "deepseek-chat",
                 "label": "DeepSeek (pago, barato)", "keyUrl": "https://platform.deepseek.com/api_keys"},
    "mistral": {"kind": "openai", "base": "https://api.mistral.ai/v1", "model": "mistral-large-latest",
                "label": "Mistral (pago, tem plano grátis)", "keyUrl": "https://console.mistral.ai/api-keys"},
    "xai": {"kind": "openai", "base": "https://api.x.ai/v1", "model": "grok-4",
            "label": "xAI Grok (pago)", "keyUrl": "https://console.x.ai"},
    "anthropic": {"kind": "anthropic", "model": "claude-opus-5-5",
                  "label": "Anthropic Claude (pago, mais forte)", "keyUrl": "https://console.anthropic.com/settings/keys"},
}

SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["resumo", "adicionar", "tirar", "trocas", "ajustes", "grupos"],
    "properties": {
        "resumo": {"type": "string"},
        "adicionar": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["carta", "porque"],
                                                  "properties": {"carta": {"type": "string"}, "porque": {"type": "string"}}}},
        "tirar": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["carta", "porque"],
                                              "properties": {"carta": {"type": "string"}, "porque": {"type": "string"}}}},
        "trocas": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["sai", "entra", "qtd", "porque"],
                                               "properties": {"sai": {"type": "string"}, "entra": {"type": "string"}, "qtd": {"type": "integer"}, "porque": {"type": "string"}}}},
        "ajustes": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["carta", "de", "para", "porque"],
                                                "properties": {"carta": {"type": "string"}, "de": {"type": "integer"}, "para": {"type": "integer"}, "porque": {"type": "string"}}}},
        "grupos": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["nome", "cartas"],
                                               "properties": {"nome": {"type": "string"}, "cartas": {"type": "array", "items": {"type": "string"}}}}},
    },
}

SYSTEM = """És um construtor de decks de Magic: The Gathering experiente, a trabalhar dentro do Grimório.
Respondes sempre em português europeu (pt-PT), de forma concreta, e só com um objeto JSON neste formato:
{"resumo": str, "adicionar": [{"carta", "porque"}], "tirar": [{"carta", "porque"}], "trocas": [{"sai", "entra", "qtd", "porque"}], "ajustes": [{"carta", "de", "para", "porque"}], "grupos": [{"nome", "cartas": [str]}]}
Regras:
- Nomes de cartas EXATAMENTE como no Oracle da Scryfall, em inglês. Nada de cartas inventadas.
- Só cartas legais no formato indicado e dentro da identidade de cor do comandante, se houver.
- Respeita o tamanho do deck: quando sugeres adicionar, diz também o que sai (em "tirar" ou "trocas") se o deck já estiver cheio.
- Usa os dados que o Grimório te dá (funções em falta, base de mana, combos, decks reais, meta) e cita-os no "porque".
- "porque" curto (1 frase) e específico deste deck: nomeia as cartas com que interage.
- "trocas": "qtd" = quantas cópias saem e entram (ex.: 4 quando trocas um playset).
- "ajustes": mudar o número de cópias de uma carta, de "de" (as que tem agora) para "para" (as que deve ter); "para": 0 tira-a, "de": 0 junta-a. Usa-os SEMPRE que o deck não tiver o tamanho certo (ex.: tem 50 de 60: completa com cópias de cartas boas ou cartas novas, e diz porquê), para equilibrar os terrenos face ao alvo da «Base de mana» (mais ou menos terrenos) e para distribuir os básicos pelas cores que o deck pede. Respeita o limite de cópias do formato.
- Trocas: propõe TANTAS quantas o deck merecer (normalmente 5 a 12, mais se o deck estiver fraco), ordenadas da mais importante para a menos; não pares em 2 ou 3 se houver cartas claramente fracas, fora do plano ou mal escolhidas para o formato.
- "grupos" só no modo reorganizar: organiza o deck inteiro em secções com função clara (ex.: "Ramp", "Motor de marcadores", "Remoção", "Finalizadores", "Terrenos"); cada carta do deck numa só secção.
- Listas vazias quando não se aplicam."""

MODES = {
    "sugerir": "Sugere melhorias: cartas para adicionar e trocas (todas as que o deck merecer, ordenadas por impacto), com prioridade ao que falta ao deck.",
    "reorganizar": "Reorganiza o deck: agrupa todas as cartas em secções por função (\"grupos\") e propõe cortes e trocas para o deck ficar mais coerente com o plano.",
    "livre": "Responde ao pedido do utilizador; usa adicionar/tirar/trocas só se fizer sentido.",
    "carta": ("Analisa SÓ a carta indicada no pedido, dentro deste deck: diz no \"resumo\" se deve ficar e porquê; em \"trocas\" "
              "propõe 3 a 6 substitutas (\"sai\" = essa carta) que sirvam melhor ESTE deck (plano, curva, cores, formato), da melhor "
              "para a pior, cada uma com o porquê; em \"ajustes\" muda as cópias dela se fizer sentido. \"adicionar\", \"tirar\" e \"grupos\" vazios."),
    "gerar": ("Cria a base de um deck NOVO a partir da ideia do utilizador. Em \"adicionar\" põe 15 a 30 cartas-chave "
              "(motor, sinergias, condições de vitória; nada de terrenos básicos). Se o formato tiver comandante, o PRIMEIRO "
              "item é o comandante e o seu \"porque\" começa por \"Comandante:\". Em \"resumo\" explica o plano do deck "
              "em 2-3 frases. \"tirar\", \"trocas\" e \"grupos\" vazios."),
}


def _cfg_path(data_dir):
    return os.path.join(data_dir, "ia.json")


def load(data_dir):
    """{active, keys: {fornecedor: chave}, models: {fornecedor: modelo}}; converte o formato antigo (um só fornecedor)."""
    try:
        with open(_cfg_path(data_dir)) as f:
            c = json.load(f)
    except (OSError, ValueError):
        c = {}
    if "keys" not in c:  # formato antigo: {provider, key, model}
        old = c
        c = {"active": old.get("provider", "off"), "keys": {}, "models": {}}
        if old.get("provider") in PROVIDERS:
            if old.get("key"):
                c["keys"][old["provider"]] = old["key"]
            if old.get("model"):
                c["models"][old["provider"]] = old["model"]
    c.setdefault("active", "off"); c.setdefault("models", {})
    return c


def _write(data_dir, c):
    path = _cfg_path(data_dir)
    fd = os.open(path + ".tmp", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(c, f)
    os.replace(path + ".tmp", path)


def public_config(data_dir):
    """Nunca devolve chaves: só se cada fornecedor tem chave e o modelo escolhido."""
    c = load(data_dir)
    act = c.get("active", "off")
    p = PROVIDERS.get(act)
    return {"provider": act, "model": c["models"].get(act) or (p or {}).get("model", ""), "hasKey": bool(c["keys"].get(act)),
            "providers": [{"id": k, **{x: v[x] for x in ("label", "model") if x in v}, "nokey": bool(v.get("nokey")), "keyUrl": v.get("keyUrl", ""),
                           "hasKey": bool(c["keys"].get(k)), "chosen": c["models"].get(k, "")} for k, v in PROVIDERS.items()]}


def save(data_dir, body):
    """{provider (o ativo), model, key} como antes, e/ou {keys: {fornecedor: chave|""}, models: {fornecedor: modelo}}."""
    c = load(data_dir)
    prov = body.get("provider", c.get("active", "off"))
    if prov != "off" and prov not in PROVIDERS:
        raise ValueError("Fornecedor desconhecido.")
    c["active"] = prov
    if prov != "off" and "model" in body:
        c["models"][prov] = str(body.get("model") or "")[:120]
    if body.get("key") and prov != "off":
        c["keys"][prov] = str(body["key"]).strip()[:400]
    for k, v in (body.get("keys") or {}).items():
        if k in PROVIDERS:
            if v:
                c["keys"][k] = str(v).strip()[:400]
            else:
                c["keys"].pop(k, None)  # "" apaga a chave
    for k, v in (body.get("models") or {}).items():
        if k in PROVIDERS:
            c["models"][k] = str(v or "")[:120]
    _write(data_dir, c)
    return public_config(data_dir)


# modelos que não são de conversa (listas dos fornecedores misturam tudo)
NOT_CHAT = re.compile(r"embed|whisper|tts|audio|dall-e|image|moderation|transcri|realtime|search|vision-preview|rerank|guard|ocr|babbage|davinci|codex-mini", re.I)
_MODELS = {}  # fornecedor -> (hora, lista); ponytail: cache em memória de 6 h


def models(data_dir, prov):
    """Modelos de conversa que a chave deste fornecedor vê, do mais recente para o mais antigo (o 1.º é a sugestão)."""
    c, p = load(data_dir), PROVIDERS.get(prov)
    if not p:
        raise ValueError("Fornecedor desconhecido.")
    key = c["keys"].get(prov)
    if not p.get("nokey") and not key:
        raise ValueError("Falta a chave deste fornecedor.")
    hit = _MODELS.get(prov)
    if hit and time.time() - hit[0] < 6 * 3600 and hit[2] == bool(key):
        return hit[1]
    try:
        if p["kind"] == "anthropic":
            req = urllib.request.Request("https://api.anthropic.com/v1/models?limit=100", headers={"x-api-key": key, "anthropic-version": "2023-06-01"})
            with urllib.request.urlopen(req, timeout=20) as r:
                data = json.load(r).get("data", [])
            rows = [(m["id"], m.get("display_name") or m["id"], str(m.get("created_at") or "")) for m in data]
        else:
            req = urllib.request.Request(p["base"] + "/models", headers={"Authorization": f"Bearer {key}"} if key else {})
            with urllib.request.urlopen(req, timeout=20) as r:
                data = json.load(r)
            data = data.get("data") or data.get("models") or []
            rows = [(m.get("id") or m.get("name", "").removeprefix("models/"), m.get("name") or m.get("id"), str(m.get("created") or 0).rjust(12, "0")) for m in data if isinstance(m, dict)]
    except urllib.error.HTTPError as e:
        raise RuntimeError({401: "Chave inválida.", 403: "A chave não tem acesso à lista de modelos."}.get(e.code, f"O fornecedor respondeu com erro {e.code}."))
    except (urllib.error.URLError, OSError, ValueError):
        raise RuntimeError("Não consegui ligar ao fornecedor de IA.")
    rows = [r for r in rows if r[0] and not NOT_CHAT.search(r[0])]
    if prov == "openrouter":  # sem chave paga: só os grátis primeiro
        rows.sort(key=lambda r: (not r[0].endswith(":free"),))
    rows.sort(key=lambda r: r[2], reverse=True)  # data de criação: o mais novo primeiro
    out = [{"id": i, "name": n} for i, n, _ in rows[:60]]
    _MODELS[prov] = (time.time(), out, bool(key))
    return out


def _post(url, headers, body, timeout=120):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json", **headers}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def _json_from_text(t):
    t = t.strip()
    m = re.search(r"\{.*\}", t, re.S)
    if not m:
        raise ValueError("A IA não devolveu JSON.")
    return json.loads(m.group(0))


def _user_prompt(payload):
    mode = payload.get("mode") if payload.get("mode") in MODES else "sugerir"
    ctx = payload.get("context") or {}
    parts = [f"Tarefa: {MODES[mode]}"]
    if payload.get("question"):
        parts.append(f"Pedido do utilizador: {str(payload['question'])[:2000]}")
    for k, label in (("formato", "Formato e regras"), ("comandante", "Comandante"), ("bracket", "Bracket alvo"),
                     ("plano", "Plano detetado"), ("arquetipo", "Arquétipo (meta)"), ("faltas", "Funções face às metas do formato"),
                     ("mana", "Base de mana"), ("combos", "Combos no deck / a uma carta"), ("validacao", "Problemas de regras"), ("contagem", "Contagem atual"),
                     ("sugestoes", "Candidatas do motor do Grimório (já legais, com o porquê)"), ("lista", "Lista atual")):
        v = ctx.get(k)
        if v:
            parts.append(f"## {label}\n{str(v)[:12000]}")
    return "\n\n".join(parts)


def ask(data_dir, payload):
    c = load(data_dir)
    name = payload.get("provider") if payload.get("provider") in PROVIDERS else c.get("active")  # pode pedir-se a outro fornecedor com chave
    prov = PROVIDERS.get(name)
    if not prov:
        raise ValueError("A IA está desligada. Escolhe um fornecedor nas definições da IA.")
    key = c["keys"].get(name)
    if not prov.get("nokey") and not key:
        raise ValueError("Falta a chave do fornecedor de IA.")
    c = {"provider": name, "key": key, "model": c["models"].get(name)}  # o resto do pedido usa estes três
    model = c.get("model") or prov["model"]
    user = _user_prompt(payload)
    try:
        if prov["kind"] == "anthropic":
            r = _post("https://api.anthropic.com/v1/messages",
                      {"x-api-key": c["key"], "anthropic-version": "2023-06-01", "anthropic-beta": "server-side-fallback-2026-07-01"},
                      {"model": model, "max_tokens": 16000, "fallbacks": "default", "system": SYSTEM,
                       "output_config": {"effort": "medium", "format": {"type": "json_schema", "schema": SCHEMA}},
                       "messages": [{"role": "user", "content": user}]})
            if r.get("stop_reason") == "refusal":
                raise ValueError("O modelo recusou o pedido.")
            text = "".join(b.get("text", "") for b in r.get("content", []) if b.get("type") == "text")
        else:
            body = {"model": model, "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}],
                    "response_format": {"type": "json_object"}}
            headers = {"Authorization": f"Bearer {c['key']}"} if c.get("key") else {}
            try:
                r = _post(prov["base"] + "/chat/completions", headers, body)
            except urllib.error.HTTPError as e:
                if e.code != 400:
                    raise
                body.pop("response_format")  # alguns modelos não aceitam o modo JSON
                r = _post(prov["base"] + "/chat/completions", headers, body)
            text = r["choices"][0]["message"]["content"] or ""
        out = _json_from_text(text)
    except urllib.error.HTTPError as e:
        msg = {401: "Chave inválida.", 403: "A chave não tem acesso a este modelo.", 404: "Modelo não encontrado neste fornecedor.",
               429: "Limite do plano atingido; tenta daqui a pouco."}.get(e.code, f"O fornecedor respondeu com erro {e.code}.")
        raise RuntimeError(msg)
    except urllib.error.URLError:
        raise RuntimeError("Não consegui ligar ao fornecedor de IA.")
    except (KeyError, IndexError, json.JSONDecodeError):
        raise RuntimeError("A resposta da IA veio num formato inesperado.")
    for k in ("adicionar", "tirar", "trocas", "ajustes", "grupos"):
        if not isinstance(out.get(k), list):
            out[k] = []
    out["resumo"] = str(out.get("resumo") or "")
    out["modelo"] = f"{c['provider']} · {model}"
    return out


if __name__ == "__main__":  # verificação sem rede
    import tempfile
    tmp = tempfile.mkdtemp()
    with open(os.path.join(tmp, "ia.json"), "w") as f:  # formato antigo -> novo
        json.dump({"provider": "deepseek", "key": "sk-1", "model": "deepseek-chat"}, f)
    assert load(tmp)["keys"] == {"deepseek": "sk-1"} and load(tmp)["active"] == "deepseek"
    save(tmp, {"provider": "openai", "key": "sk-2"})
    pc = public_config(tmp)
    assert pc["provider"] == "openai" and {p["id"]: p["hasKey"] for p in pc["providers"]}["deepseek"] and "sk-" not in json.dumps(pc)
    save(tmp, {"keys": {"deepseek": ""}})
    assert not {p["id"]: p["hasKey"] for p in public_config(tmp)["providers"]}["deepseek"]
    assert NOT_CHAT.search("text-embedding-3-large") and not NOT_CHAT.search("gpt-5")
    assert "TANTAS" in SYSTEM and "ajustes" in SCHEMA["required"]
    assert "50 de 60" in _user_prompt({"context": {"contagem": "main: 50 de 60"}})
    assert _json_from_text('```json\n{"resumo": "ok", "adicionar": []}\n```')["resumo"] == "ok"
    p = _user_prompt({"mode": "reorganizar", "question": "mais ramp", "context": {"lista": "1 Sol Ring", "comandante": "Atraxa"}})
    assert "agrupa" in p and "Sol Ring" in p and "Atraxa" in p
    assert "NOVO" in _user_prompt({"mode": "gerar", "question": "elfos"})
    print("selfcheck ok")
