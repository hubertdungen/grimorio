#!/usr/bin/env bash
# Atualiza os dados do Grimório: descarrega Scryfall + Commander Spellbook e recalcula
# embeddings, mapa 3D e combos num contentor (o host não tem numpy). Tudo gratuito.
set -euo pipefail
D="${GRIMORIO_DATA_DIR:-$HOME/.local/share/grimorio}"
SRC="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$D/raw" "$D/data.new" "$D/pydeps" "$D/cache"

UA='User-Agent: Grimorio/1.0 (+https://github.com/hubertdungen/grimorio)'
bulk() { curl -fsS -H "$UA" -H 'Accept: application/json' https://api.scryfall.com/bulk-data \
  | python3 -c "import json,sys; print([d['jsonl_download_uri'] for d in json.load(sys.stdin)['data'] if d['type']=='$1'][0])"; }
curl -fsS -H "$UA" -o "$D/raw/oracle.jsonl.gz" "$(bulk oracle_cards)"
curl -fsS -o "$D/raw/variants.json.gz" https://json.commanderspellbook.com/variants.json.gz

if [[ ! -d "$D/pydeps/fastembed" ]]; then
  docker run --rm -v "$D/pydeps:/deps" python:3.12-slim pip install -q --target /deps fastembed umap-learn ijson
fi

# nice + 3 threads: numa máquina de 4 threads com outros serviços a correr.
docker run --rm --cpus 3 --user "$(id -u):$(id -g)" -e HOME=/cache -e PYTHONPATH=/deps -e OMP_NUM_THREADS=3 -e NUMBA_CACHE_DIR=/cache/numba \
  -v "$D/pydeps:/deps:ro" -v "$D/cache:/cache" -v "$D/raw:/raw:ro" -v "$D/data.new:/out" -v "$SRC:/src:ro" \
  python:3.12-slim nice -n 10 python /src/build_data.py /raw /out

# Tokens reais (imagens das fichas que cada carta cria); stdlib, segundos.
python3 "$SRC/tokens.py" "$D/raw" "$D/data.new"

# Vocabulário da pesquisa (edições, universos, nomes alternativos, tipos traduzidos); stdlib, ~1 min. Todas as impressões
# (~80 MB) a cada vez; as noutras línguas (~400 MB, só para os nomes dos tipos) de 60 em 60 dias. Sem ele a app procura
# as edições na Scryfall, como antes: uma falha aqui não estraga o resto.
{ curl -fsS -H "$UA" -o "$D/raw/default.jsonl.gz" "$(bulk default_cards)" \
  && curl -fsS -H "$UA" -H 'Accept: application/json' -o "$D/raw/sets.json" https://api.scryfall.com/sets \
  && { [[ -n "$(find "$D/raw/all.jsonl.gz" -mtime -60 2>/dev/null)" ]] || { curl -fsS -H "$UA" -o "$D/raw/all.part" "$(bulk all_cards)" && mv "$D/raw/all.part" "$D/raw/all.jsonl.gz"; } || true; } \
  && python3 "$SRC/vocab.py" "$D/raw" "$D/data.new"; } || echo "vocab: falhou (a pesquisa de edições fica pela Scryfall)" >&2

# Troca atómica: o servidor nunca vê dados a meio.
rm -rf "$D/data.old"; [[ -d "$D/data" ]] && mv "$D/data" "$D/data.old"
mv "$D/data.new" "$D/data"
rm -rf "$D/data.old"
echo "dados do Grimório atualizados: $(cat "$D/data/meta.json")"
