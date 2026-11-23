#!/bin/sh
# Container start: back up the database when the version changed, download this version's card data to the volume
# (first start, or a new image), then the server. Same steps as the desktop launcher, without its self-update.
set -e
python3 -c 'import sys; sys.path.insert(0, "/opt/grimorio/app"); import launcher as l
d, v = l.data_dir(), l.version(); l.backup_db(d, v); l.install_data(d, v)'
exec python3 /opt/grimorio/app/server.py --host 0.0.0.0 --port 8107 --data-dir "$GRIMORIO_DATA_DIR" "$@"
