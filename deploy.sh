#!/usr/bin/env bash
# Compila o frontend e instala a app em ~/.local/share/grimorio/app (de onde o servidor corre).
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
APP="${GRIMORIO_DATA_DIR:-$HOME/.local/share/grimorio}/app"
(cd "$SRC/web" && npx vite build --logLevel warn)
"$SRC/build/forge/build.sh"  # lançador do Forge com eventos exatos (só recompila se mudou)
"$SRC/build/play/build.sh"   # jogar contra o Forge: imagem grimorio-play, lançador GrimorioPlay e noVNC (idem)
rm -rf "$APP.new" && mkdir -p "$APP.new/web"
cp "$SRC/server.py" "$SRC/backup.py" "$SRC/deck_import.py" "$SRC/ia.py" "$SRC/sim.py" "$SRC/play.py" "$SRC/ratings.py" "$SRC/tournament.py" "$SRC/artfolder.py" "$SRC/guests.py" "$SRC/rooms.py" "$SRC/share.py" "$SRC/rules.py" "$APP.new/"
cp -r "$SRC/web/dist" "$APP.new/web/dist"
find "$APP.new/web/dist" -type f \( -name '*.js' -o -name '*.css' -o -name '*.svg' -o -name '*.html' \) -exec gzip -k9 {} \;
rm -rf "$APP.old"; [[ -d "$APP" ]] && mv "$APP" "$APP.old"
mv "$APP.new" "$APP" && rm -rf "$APP.old"
# reinicia o servidor: GRIMORIO_RESTART (comando) ou ~/scripts/grimorio-server.sh, se existir
R="${GRIMORIO_RESTART:-$HOME/scripts/grimorio-server.sh restart}"
if [[ -x "${R%% *}" ]]; then $R; else echo "Instalado em $APP — reinicia o servidor (python3 $APP/server.py)."; fi
