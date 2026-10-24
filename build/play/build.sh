#!/usr/bin/env bash
# Jogar contra o Forge no browser (play.py): imagem grimorio-play, lançador GrimorioPlay e cliente noVNC.
# Idempotente: cada peça só é refeita quando a fonte muda.
set -euo pipefail
D="${GRIMORIO_DATA_DIR:-$HOME/.local/share/grimorio}"
SRC="$(cd "$(dirname "$0")" && pwd)"

# imagem (etiqueta = hash do Dockerfile + start.sh)
TAG=$(cat "$SRC/Dockerfile" "$SRC/start.sh" | sha256sum | cut -c1-12)
if ! docker image inspect "grimorio-play:$TAG" >/dev/null 2>&1; then
  docker build -q -t "grimorio-play:$TAG" -t grimorio-play:latest -f "$SRC/Dockerfile" "$SRC"
  docker images grimorio-play --format '{{.Tag}}' | grep -vx -e latest -e "$TAG" | sed 's/^/grimorio-play:/' | xargs -r docker rmi -f >/dev/null
fi

# lançador
JAR=$(ls "$D"/forge/forge-gui-desktop-*-jar-with-dependencies.jar | head -1)
OUT="$D/forge-play-ext"
STAMP="$(sha256sum "$SRC/GrimorioPlay.java" | cut -c1-16) $(basename "$JAR") $(stat -c %s.%Y "$JAR")"
if [[ ! -f "$OUT/GrimorioPlay.class" || "$(cat "$OUT/stamp" 2>/dev/null)" != "$STAMP" ]]; then
  rm -rf "$OUT.new"; mkdir -p "$OUT.new"
  docker run --rm --user "$(id -u):$(id -g)" -v "$JAR:/forge.jar:ro" -v "$SRC:/src:ro" -v "$OUT.new:/out" \
    eclipse-temurin:17-jdk javac -nowarn -encoding UTF-8 -cp /forge.jar -d /out /src/GrimorioPlay.java
  echo "$STAMP" > "$OUT.new/stamp"
  rm -rf "$OUT"; mv "$OUT.new" "$OUT"
fi

# cliente noVNC (só core/ e vendor/: a página play.html é nossa)
NOVNC=1.6.0
if [[ ! -f "$D/novnc/VERSION-$NOVNC" ]]; then
  T=$(mktemp -d)
  curl -fsSL "https://github.com/novnc/noVNC/archive/refs/tags/v$NOVNC.tar.gz" | tar -xz -C "$T"
  rm -rf "$D/novnc.new"; mkdir -p "$D/novnc.new"
  cp -r "$T/noVNC-$NOVNC/core" "$T/noVNC-$NOVNC/vendor" "$T/noVNC-$NOVNC/LICENSE.txt" "$D/novnc.new/"
  touch "$D/novnc.new/VERSION-$NOVNC"
  rm -rf "$T" "$D/novnc"; mv "$D/novnc.new" "$D/novnc"
fi
echo "grimorio-play em dia"
