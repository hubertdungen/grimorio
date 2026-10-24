#!/usr/bin/env bash
# Compila o lançador GrimorioSim (observa os eventos do Forge) para ~/.local/share/grimorio/forge-ext/ e gera
# os nossos perfis de IA em forge-ext/ai/: cópias dos res/ai/*.ai do Forge em que cada CHANCE a 0 ou 100 passa a
# 10 ou 90 (há sempre situações em que não compensa); limiares, contagens e booleanos ficam iguais. As chances de
# contrariar (CHANCE_TO_COUNTER_*) ficam como o Forge as tem: com 90% o bot deixava passar 1 em 10 feitiços de 3+.
# Cartas com guião próprio (cards/*.txt, AI-hints para a IA do Forge) vão para forge-ext/cardsfolder/<letra>/ ao lado
# do cardsfolder.zip do Forge: o Forge lê primeiro os .txt soltos e ignora a mesma carta no zip.
# Idempotente: só refaz se o .java, este script, as cartas ou o jar do Forge mudarem. O sim.py usa tudo isto quando existe.
set -euo pipefail
shopt -s nullglob
D="${GRIMORIO_DATA_DIR:-$HOME/.local/share/grimorio}"
SRC="$(cd "$(dirname "$0")" && pwd)"
JAR=$(ls "$D"/forge/forge-gui-desktop-*-jar-with-dependencies.jar | head -1)
OUT="$D/forge-ext"
STAMP="$(cat "$SRC/GrimorioSim.java" "$0" "$SRC"/cards/*.txt | sha256sum | cut -c1-16) $(basename "$JAR") $(stat -c %s.%Y "$JAR")"
if [[ -f "$OUT/GrimorioSim.class" && "$(cat "$OUT/stamp" 2>/dev/null)" == "$STAMP" ]]; then
  echo "forge-ext em dia"; exit 0
fi
rm -rf "$OUT.new"; mkdir -p "$OUT.new"
docker run --rm --user "$(id -u):$(id -g)" -v "$JAR:/forge.jar:ro" -v "$SRC:/src:ro" -v "$OUT.new:/out" \
  eclipse-temurin:17-jdk javac -nowarn -encoding UTF-8 -cp /forge.jar -d /out /src/GrimorioSim.java
mkdir -p "$OUT.new/ai"
for f in "$D"/forge/res/ai/*.ai; do
  sed -E '/^CHANCE_TO_COUNTER_/b; s/^([A-Z0-9_]*CHANCE[A-Z0-9_]*)=0(\r?)$/\1=10\2/; s/^([A-Z0-9_]*CHANCE[A-Z0-9_]*)=100(\r?)$/\1=90\2/' "$f" > "$OUT.new/ai/$(basename "$f")"
done
for f in "$SRC"/cards/*.txt; do
  n=$(basename "$f"); mkdir -p "$OUT.new/cardsfolder/${n:0:1}"; cp "$f" "$OUT.new/cardsfolder/${n:0:1}/"
done
if [[ -d "$OUT.new/cardsfolder" ]]; then  # mesmo disco: ligação; senão cópia (16 MB)
  ln "$D/forge/res/cardsfolder/cardsfolder.zip" "$OUT.new/cardsfolder/" 2>/dev/null || cp "$D/forge/res/cardsfolder/cardsfolder.zip" "$OUT.new/cardsfolder/"
fi
echo "$STAMP" > "$OUT.new/stamp"
rm -rf "$OUT"; mv "$OUT.new" "$OUT"
echo "forge-ext compilado: $OUT"
