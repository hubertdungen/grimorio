"""Assistente de IA do Grimório (extra opcional): sugerir e reorganizar decks.

Fornecedores: os gratuitos falam a API compatível com OpenAI (Gemini, Groq, OpenRouter
com modelos :free, Ollama local); o Claude (pago) usa a Messages API da Anthropic.
Stdlib apenas (o host não tem pip). A chave fica em <data>/ia.json (0600) e nunca
vai para o browser. A resposta é JSON com o esquema SCHEMA; o browser valida cada
carta contra a base antes de a mostrar.
"""
import json, os, re, urllib.error, urllib.request

PROVIDERS = {
    "gemini": {"kind": "openai", "base": "https://generativelanguage.googleapis.com/v1beta/openai", "model": "gemini-2.5-flash",
               "label": "Google Gemini (grátis, com limite diário)", "keyUrl": "https://aistudio.google.com/apikey"},
    "groq": {"kind": "openai", "base": "https://api.groq.com/openai/v1", "model": "llama-3.3-70b-versatile",
             "label": "Groq (grátis, com limite por minuto)", "keyUrl": "https://console.groq.com/keys"},
    "openrouter": {"kind": "openai", "base": "https://openrouter.ai/api/v1", "model": "meta-llama/llama-3.3-70b-instruct:free",
                   "label": "OpenRouter (modelos :free)", "keyUrl": "https://openrouter.ai/keys"},
    "ollama": {"kind": "openai", "base": "http://127.0.0.1:11434/v1", "model": "llama3.1",
               "label": "Ollama local (grátis, precisa de máquina com RAM)", "nokey": True},
    "anthropic": {"kind": "anthropic", "model": "claude-opus-5-5",
                  "label": "Anthropic Claude (pago, mais forte)", "keyUrl": "https://console.anthropic.com/settings/keys"},
}

SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["resumo", "adicionar", "tirar", "trocas", "grupos"],
    "properties": {
        "resumo": {"type": "string"},
        "adicionar": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["carta", "porque"],
                                                  "properties": {"carta": {"type": "string"}, "porque": {"type": "string"}}}},
        "tirar": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["carta", "porque"],
                                              "properties": {"carta": {"type": "string"}, "porque": {"type": "string"}}}},
        "trocas": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["sai", "entra", "porque"],
                                               "properties": {"sai": {"type": "string"}, "entra": {"type": "string"}, "porque": {"type": "string"}}}},
        "grupos": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["nome", "cartas"],
                                               "properties": {"nome": {"type": "string"}, "cartas": {"type": "array", "items": {"type": "string"}}}}},
    },
}

SYSTEM = """És um construtor de decks de Magic: The Gathering experiente, a trabalhar dentro do Grimório.
Respondes sempre em português europeu (pt-PT), de forma concreta, e só com um objeto JSON neste formato:
{"resumo": str, "adicionar": [{"carta", "porque"}], "tirar": [{"carta", "porque"}], "trocas": [{"sai", "entra", "porque"}], "grupos": [{"nome", "cartas": [str]}]}
Regras:
- Nomes de cartas EXATAMENTE como no Oracle da Scryfall, em inglês. Nada de cartas inventadas.
- Só cartas legais no formato indicado e dentro da identidade de cor do comandante, se houver.
- Respeita o tamanho do deck: quando sugeres adicionar, diz também o que sai (em "tirar" ou "trocas") se o deck já estiver cheio.
- Usa os dados que o Grimório te dá (funções em falta, base de mana, combos, decks reais, meta) e cita-os no "porque".
- "porque" curto (1 frase) e específico deste deck: nomeia as cartas com que interage.
- "grupos" só no modo reorganizar: organiza o deck inteiro em secções com função clara (ex.: "Ramp", "Motor de marcadores", "Remoção", "Finalizadores", "Terrenos"); cada carta do deck numa só secção.
- Listas vazias quando não se aplicam."""

MODES = {
    "sugerir": "Sugere melhorias: cartas para adicionar e trocas, com prioridade ao que falta ao deck.",
    "reorganizar": "Reorganiza o deck: agrupa todas as cartas em secções por função (\"grupos\") e propõe cortes e trocas para o deck ficar mais coerente com o plano.",
    "livre": "Responde ao pedido do utilizador; usa adicionar/tirar/trocas só se fizer sentido.",
    "gerar": ("Cria a base de um deck NOVO a partir da ideia do utilizador. Em \"adicionar\" põe 15 a 30 cartas-chave "
              "(motor, sinergias, condições de vitória; nada de terrenos básicos). Se o formato tiver comandante, o PRIMEIRO "
              "item é o comandante e o seu \"porque\" começa por \"Comandante:\". Em \"resumo\" explica o plano do deck "
              "em 2-3 frases. \"tirar\", \"trocas\" e \"grupos\" vazios."),
}


def _cfg_path(data_dir):
    return os.path.join(data_dir, "ia.json")


def load(data_dir):
    try:
        with open(_cfg_path(data_dir)) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"provider": "off"}


def public_config(data_dir):
    c = load(data_dir)
    p = PROVIDERS.get(c.get("provider"))
    return {"provider": c.get("provider", "off"), "model": c.get("model") or (p or {}).get("model", ""),
            "hasKey": bool(c.get("key")), "providers": [{"id": k, **{x: v[x] for x in ("label", "model") if x in v},
                                                         "nokey": bool(v.get("nokey")), "keyUrl": v.get("keyUrl", "")} for k, v in PROVIDERS.items()]}


def save(data_dir, body):
    c = load(data_dir)
    prov = body.get("provider", "off")
    if prov != "off" and prov not in PROVIDERS:
        raise ValueError("Fornecedor desconhecido.")
    if prov != c.get("provider"):
        c.pop("key", None)  # chave de outro fornecedor não serve
    c["provider"] = prov
    c["model"] = str(body.get("model") or "")[:120]
    if body.get("key"):
        c["key"] = str(body["key"]).strip()[:400]
    path = _cfg_path(data_dir)
    fd = os.open(path + ".tmp", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(c, f)
    os.replace(path + ".tmp", path)
    return public_config(data_dir)


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
                     ("mana", "Base de mana"), ("combos", "Combos no deck / a uma carta"), ("validacao", "Problemas de regras"),
                     ("sugestoes", "Candidatas do motor do Grimório (já legais, com o porquê)"), ("lista", "Lista atual")):
        v = ctx.get(k)
        if v:
            parts.append(f"## {label}\n{str(v)[:12000]}")
    return "\n\n".join(parts)


def ask(data_dir, payload):
    c = load(data_dir)
    prov = PROVIDERS.get(c.get("provider"))
    if not prov:
        raise ValueError("A IA está desligada. Escolhe um fornecedor nas definições da IA.")
    if not prov.get("nokey") and not c.get("key"):
        raise ValueError("Falta a chave do fornecedor de IA.")
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
    for k in ("adicionar", "tirar", "trocas", "grupos"):
        if not isinstance(out.get(k), list):
            out[k] = []
    out["resumo"] = str(out.get("resumo") or "")
    out["modelo"] = f"{c['provider']} · {model}"
    return out


if __name__ == "__main__":  # verificação sem rede
    assert _json_from_text('```json\n{"resumo": "ok", "adicionar": []}\n```')["resumo"] == "ok"
    p = _user_prompt({"mode": "reorganizar", "question": "mais ramp", "context": {"lista": "1 Sol Ring", "comandante": "Atraxa"}})
    assert "agrupa" in p and "Sol Ring" in p and "Atraxa" in p
    assert "NOVO" in _user_prompt({"mode": "gerar", "question": "elfos"})
    print("selfcheck ok")
