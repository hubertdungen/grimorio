#!/usr/bin/env bash
# Compila o lançador GrimorioSim (observa os eventos do Forge) e o GrimorioNet (Forge Play nativo: o ecrã do humano em JSON) para ~/.local/share/grimorio/forge-ext/ e gera
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
STAMP="$(cat "$SRC/GrimorioSim.java" "$SRC/GrimorioNet.java" "$0" "$SRC"/cards/*.txt | sha256sum | cut -c1-16) $(basename "$JAR") $(stat -c %s.%Y "$JAR")"
if [[ -f "$OUT/GrimorioSim.class" && "$(cat "$OUT/stamp" 2>/dev/null)" == "$STAMP" ]]; then
  echo "forge-ext em dia"; exit 0
fi
rm -rf "$OUT.new"; mkdir -p "$OUT.new"
# javac do sistema (JDK 17+, ou JAVAC=/caminho/javac) quando existe — CI e pacotes sem Docker; senão num contentor
JAVAC="${JAVAC:-$(command -v javac || true)}"
if [[ -n "$JAVAC" ]]; then
  "$JAVAC" --release 17 -nowarn -encoding UTF-8 -cp "$JAR" -d "$OUT.new" "$SRC/GrimorioSim.java" "$SRC/GrimorioNet.java"
else
  docker run --rm --user "$(id -u):$(id -g)" -v "$JAR:/forge.jar:ro" -v "$SRC:/src:ro" -v "$OUT.new:/out" \
    eclipse-temurin:17-jdk javac -nowarn -encoding UTF-8 -cp /forge.jar -d /out /src/GrimorioSim.java /src/GrimorioNet.java
fi
mkdir -p "$OUT.new/ai"
for f in "$D"/forge/res/ai/*.ai; do
  sed -E '/^CHANCE_TO_COUNTER_/b; s/^([A-Z0-9_]*CHANCE[A-Z0-9_]*)=0(\r?)$/\1=10\2/; s/^([A-Z0-9_]*CHANCE[A-Z0-9_]*)=100(\r?)$/\1=90\2/' "$f" > "$OUT.new/ai/$(basename "$f")"
done
for f in "$SRC"/cards/*.txt; do
  n=$(basename "$f"); mkdir -p "$OUT.new/cardsfolder/${n:0:1}"; cp "$f" "$OUT.new/cardsfolder/${n:0:1}/"
done
# Cartas com «AI:RemoveDeck:All» que a IA do Forge nunca lança (AiController tira-as da lista de jogadas) mas cuja
# habilidade é de um tipo que a IA genérica sabe usar (mana, compra, criatura simples, +1/+1 a todas): o guião do zip
# sem essa linha. As outras (Prismatic Strands, Scapeshift, Freed from the Real, Emrakul, the Promised End…) ficam de
# fora: sem lógica própria jogavam-se à toa.
ZIP="$D/forge/res/cardsfolder/cardsfolder.zip"
for n in faithless_looting tinder_wall orochi_leafcaller quirion_ranger marauding_raptor deftblade_elite ramosian_rally springleaf_drum \
         springjack_pasture azorius_signet boros_signet dimir_signet golgari_signet gruul_signet izzet_signet \
         orzhov_signet rakdos_signet selesnya_signet simic_signet heritage_druid birchlore_rangers; do
  [[ -f "$SRC/cards/$n.txt" ]] && continue
  mkdir -p "$OUT.new/cardsfolder/${n:0:1}"
  python3 -c 'import sys, zipfile; sys.stdout.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]).decode())' "$ZIP" "${n:0:1}/$n.txt" \
    | grep -v '^AI:RemoveDeck:All' > "$OUT.new/cardsfolder/${n:0:1}/$n.txt"
done
if [[ -d "$OUT.new/cardsfolder" ]]; then  # mesmo disco: ligação; senão cópia (16 MB)
  ln "$D/forge/res/cardsfolder/cardsfolder.zip" "$OUT.new/cardsfolder/" 2>/dev/null || cp "$D/forge/res/cardsfolder/cardsfolder.zip" "$OUT.new/cardsfolder/"
fi
echo "$STAMP" > "$OUT.new/stamp"
# troca sem apagar: jogos a decorrer têm a pasta antiga montada no contentor e continuam a lê-la; as antigas saem
# ao fim de 6 h, na próxima compilação
if [[ -d "$OUT" ]]; then OLD="$OUT.old.$(date +%s)"; mv "$OUT" "$OLD"; touch "$OLD"; fi  # touch: conta 6 h a partir de agora
mv "$OUT.new" "$OUT"
find "$(dirname "$OUT")" -maxdepth 1 -name "$(basename "$OUT").old.*" -mmin +360 -exec rm -rf {} + 2>/dev/null || true
echo "forge-ext compilado: $OUT"
