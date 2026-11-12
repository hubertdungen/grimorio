"""Cópias e sincronização por pasta na nuvem (opcional).

Exportar: um ficheiro .grimorio (zip) com manifest.json, uma fotografia consistente da base de dados (API de backup do
SQLite) e as capas próprias. Importar: valida, guarda a base atual em grimorio.db.before-import-<hora> e junta (merge)
ou substitui (replace).

Sincronizar (desligado por omissão): o utilizador escolhe uma pasta que uma app grátis mantém na nuvem (Google Drive para
computador, OneDrive, Dropbox, Nextcloud, Syncthing, iCloud Drive). Cada aparelho escreve SÓ o seu ficheiro
grimorio-<aparelho>.grimorio (escrita atómica: temporário + rename, a app de sync nunca apanha meio ficheiro) e junta os
dos outros quando mudam. O Grimório trabalha sempre na base local: sem rede (num avião) continua igual e a app de sync
leva e traz os ficheiros quando voltar a haver rede.

Regras da junção (nunca apaga dados):
- decks por id: ganha a alteração mais recente (max de updated e deleted, por isso o lixo também conta); se os dois
  lados mudaram desde a última junção com esse aparelho (ou nunca se juntaram), o que perde fica como cópia
  «nome (conflito)» com id fixo (o mesmo nos dois aparelhos: não se duplica);
- perfis, sessões de testes (sim_runs): união por id; jogos do Laboratório (sim_games): união pelo conteúdo;
- torneios por id: fica a versão mais avançada (acabada > a decorrer, depois mais jogos) com os jogos e as apostas dela;
  um torneio a decorrer que chega de outro aparelho fica em pausa (só um aparelho o joga de cada vez);
- carteiras: o maior saldo (moedas a fingir: nunca se perde nada);
- ratings: os jogos (rating_games) juntam-se pelo conteúdo e os ratings refazem-se a partir deles (rebuild_ratings),
  respeitando os recomeços (ratings_kv reset:<chave>).
Modo login (vários utilizadores atrás de um proxy): cada um exporta e junta só o que é seu; sem substituir nem pasta.

Versões: o manifest leva `level` (o que quem escreveu sabe juntar), `needs` (o nível mínimo para juntar esta cópia sem
perder nada) e `version` (a versão da app). Quem recebe uma cópia com `needs` acima do seu LEVEL recusa-a com uma frase
clara («atualiza este aparelho para a versão X»); cópias antigas passam por migrate() (colunas e tabelas que faltam).

Apagados (tombstones, nível 2): apagar de vez (lixo dos decks com mais de 30 dias, torneios, sessões de testes, perfis)
deixa uma marca (kind, id, dono, hora) que viaja com a sincronização e apaga a linha nos outros aparelhos — um aparelho
antigo nunca ressuscita o que já se apagou. Uma alteração feita DEPOIS de apagar ganha (como nos decks). Os dados apagados
ficam 30 dias na marca (só neste aparelho) para se poderem repor; repor marca `revived` e a linha volta a viajar.

O que é desta instalação e não viaja: amigos e convites, salas, mesas livres, a Taverna, «Os meus jogos», aparelhos ligados
e os decks que os amigos trouxeram (`friend`). As cópias para sincronizar (scrub) saem sem isso e sem páginas livres
(VACUUM: nada do que se tirou fica no ficheiro).
"""
import atexit, json, os, re, socket, sqlite3, sys, tempfile, threading, time, uuid, zipfile, zlib

import ratings

FORMAT = 1  # o contentor (zip + manifest + grimorio.db): só sobe se o próprio ficheiro mudar de forma
LEVEL = 2   # o que esta versão sabe juntar: 1 = decks, torneios, ratings…; 2 = + apagados (tombstones)
NEEDS = 1   # o nível mínimo para juntar o que esta versão escreve (sobe só com mudanças que um aparelho antigo estragaria)
KEEP_BACKUPS = {"import": 5, "sync": 3}  # cópias da base antes de juntar (as mais recentes ficam)
HOST_LOCAL = ("friends", "rooms", "freetables", "taverna", "taverna_members", "taverna_msgs", "taverna_shelf", "taverna_results",
              "my_games", "host_meta", "devices", "device_codes", "avatars")
TOMB = ("CREATE TABLE IF NOT EXISTS tombstones (kind TEXT, id TEXT, owner TEXT, ts REAL, revived REAL, data BLOB,"
        " PRIMARY KEY (kind, id))")
# o que se apaga de vez: tabela e a hora da última alteração da linha (uma alteração depois de apagar ganha)
KINDS = {"deck": ("decks", "max(coalesce(updated, 0), coalesce(deleted, 0))"), "sim_run": ("sim_runs", "coalesce(ts, 0)"),
         "tournament": ("tournaments", "coalesce(ts, 0)"), "profile": ("profiles", "coalesce(created, 0)")}
UNDO_DAYS = 30
COVER = re.compile(r"^[a-z0-9-]{8,40}\.(?:jpg|png|webp|gif)$")
TICK = 60  # segundos entre verificações da pasta
LOCK = threading.RLock()
DATA = None


def db_path(data_dir):
    return os.path.join(data_dir, "grimorio.db")


# ---------- fotografia (zip) ----------

def _filter_owner(con, owner):
    """Deixa só os dados de `owner` numa cópia da base (exportação no modo login, sincronização com um servidor)."""
    mine = [r[0] for r in con.execute("SELECT id FROM decks WHERE owner=?", (owner,))]
    keys = [f"deck:{i}" for i in mine]
    q = ",".join("?" * len(keys)) or "''"
    rk = ",".join("?" * len(keys)) or "''"
    for sql, a in (("DELETE FROM decks WHERE owner IS NOT ?", (owner,)), ("DELETE FROM sim_runs WHERE owner IS NOT ?", (owner,)),
                   (f"DELETE FROM sim_games WHERE deck_id NOT IN ({','.join('?' * len(mine)) or chr(39) * 2})", mine),
                   ("DELETE FROM tournaments WHERE owner IS NOT ?", (owner,)),
                   ("DELETE FROM tournament_games WHERE tid NOT IN (SELECT id FROM tournaments)", ()),
                   ("DELETE FROM bets WHERE owner IS NOT ?", (owner,)), ("DELETE FROM wallets WHERE owner IS NOT ?", (owner,)),
                   ("DELETE FROM profiles", ()), ("DELETE FROM tombstones WHERE owner IS NOT ? OR kind='profile'", (owner,)),
                   (f"DELETE FROM ratings_kv WHERE substr(k, 7) NOT IN ({rk}) OR k NOT LIKE 'reset:%'", keys),  # recomeços dos decks dele
                   (f"DELETE FROM rating_games WHERE a_key NOT IN ({q}) AND b_key NOT IN ({q})", keys * 2),
                   (f"DELETE FROM ratings WHERE key NOT IN ({q})", keys)):
        try:
            con.execute(sql, a)
        except sqlite3.OperationalError:  # tabela que esta instalação ainda não tem
            pass
    return set(mine)


def _scrub(con):
    """Tira o que é desta instalação (HOST_LOCAL, decks dos amigos) e os dados guardados para repor (ficam só aqui)."""
    for t in HOST_LOCAL:
        con.execute(f"DROP TABLE IF EXISTS {t}")
    con.execute("DELETE FROM decks WHERE json_extract(body, '$.friend') IS NOT NULL")
    if _has(con, "main", "tombstones"):
        con.execute("UPDATE tombstones SET data=NULL")


def _sync_copy(data_dir, tmpdb, owner, skip):
    """A base para sincronizar: as tabelas de SYNC_TABLES com só as linhas que viajam (do dono, sem decks de amigos, sem os
    torneios em `skip` que o outro lado já tem iguais ou mais avançados, marcas sem os dados para repor). Uma leitura só
    (consistente) da base viva. -> (ids dos decks, progresso dos torneios)."""
    dst = sqlite3.connect(tmpdb)
    try:
        dst.execute("ATTACH DATABASE ? AS s", (db_path(data_dir),))
        with LOCK:
            dst.execute("BEGIN")
            have = {}
            if _has(dst, "s", "tournaments"):
                n = dict(dst.execute("SELECT tid, COUNT(*) FROM s.tournament_games GROUP BY tid"))
                have = {t: [int(st in ("done", "cancelled", "error")), n.get(t, 0)]
                        for t, st in dst.execute("SELECT id, status FROM s.tournaments WHERE ? IS NULL OR owner=?", (owner, owner))}
            gone = {t for t, p in have.items() if skip and t in skip and isinstance(skip[t], (list, tuple)) and list(skip[t]) >= p}
            dst.execute("CREATE TEMP TABLE gone (id TEXT PRIMARY KEY)")
            dst.executemany("INSERT INTO gone VALUES (?)", [(t,) for t in gone])
            o = "(? IS NULL OR owner=?)"
            keys = "(SELECT 'deck:' || id FROM main.decks)"
            plan = {"decks": (f"{o} AND json_extract(body, '$.friend') IS NULL", 2),
                    "sim_runs": (o, 2), "sim_games": ("deck_id IN (SELECT id FROM main.decks)", 0),
                    "profiles": ("? IS NULL", 1), "tournaments": (f"{o} AND id NOT IN (SELECT id FROM temp.gone)", 2),
                    "tournament_games": ("tid IN (SELECT id FROM main.tournaments)", 0), "wallets": (o, 2), "bets": (o, 2),
                    "ratings": (f"? IS NULL OR key IN {keys}", 1), "rating_games": (f"? IS NULL OR a_key IN {keys} OR b_key IN {keys}", 1),
                    "ratings_kv": (f"? IS NULL OR (k LIKE 'reset:%' AND substr(k, 7) IN {keys})", 1), "tombstones": (o, 2)}
            for t in SYNC_TABLES:
                if not _has(dst, "s", t):
                    continue
                sql = dst.execute("SELECT sql FROM s.sqlite_master WHERE type='table' AND name=?", (t,)).fetchone()[0]
                dst.execute(re.sub(r'^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"?\w+"?', f"CREATE TABLE main.{t}", sql, count=1))
                where, na = plan[t]
                dst.execute(f"INSERT INTO main.{t} SELECT * FROM s.{t} WHERE {where}", (owner,) * na)
            if _has(dst, "main", "tombstones"):
                dst.execute("UPDATE main.tombstones SET data=NULL")
            dst.commit()
        mine = {r[0] for r in dst.execute("SELECT id FROM main.decks")}
        dst.execute("DETACH DATABASE s")
        return mine, have
    finally:
        dst.close()


def progress(con, owner=None):
    """{id do torneio: [acabado, nº de jogos]} — o que cada lado já tem (a junção fica com o mais avançado)."""
    if not _has(con, "main", "tournaments"):
        return {}
    n = dict(con.execute("SELECT tid, COUNT(*) FROM tournament_games GROUP BY tid"))
    return {t: [int(st in ("done", "cancelled", "error")), n.get(t, 0)]
            for t, st in con.execute("SELECT id, status FROM tournaments WHERE ? IS NULL OR owner=?", (owner, owner))}


def app_version():
    return os.environ.get("GRIMORIO_VERSION") or "dev"


def snapshot(data_dir, dest, owner=None, device="", scrub=False, skip=None, extra=None):
    """Escreve o .grimorio em `dest` (atómico). owner = só os dados dele (modo login, servidor). scrub = para sincronizar
    (sem o que é só desta instalação). skip = {id do torneio: [acabado, jogos]} que o outro lado já tem pelo menos assim
    (não vão: a junção ficava com os dele de qualquer forma — é o que torna a sincronização com um servidor um delta).
    extra = mais campos no manifest. Devolve o manifest."""
    fd, tmpdb = tempfile.mkstemp(prefix="snap-", suffix=".db", dir=data_dir)
    os.close(fd)
    try:
        if scrub:  # para sincronizar: só as linhas que viajam, copiadas para uma base nova (não se copia nem limpa a base toda)
            mine, have = _sync_copy(data_dir, tmpdb, owner, skip)
            skip = None
            dst = sqlite3.connect(tmpdb)
        else:
            src, dst = sqlite3.connect(db_path(data_dir), timeout=30), sqlite3.connect(tmpdb)
            with LOCK:
                src.backup(dst)
            src.close()
            mine = _filter_owner(dst, owner) if owner else None
            have = progress(dst)
        if skip:
            gone = [t for t, p in have.items() if t in skip and list(skip[t]) >= p]
            for i in range(0, len(gone), 500):
                part = gone[i:i + 500]
                q = ",".join("?" * len(part))
                dst.execute(f"DELETE FROM tournament_games WHERE tid IN ({q})", part)
                dst.execute(f"DELETE FROM tournaments WHERE id IN ({q})", part)
        dst.commit()
        if (owner or skip) and not scrub:
            dst.execute("VACUUM")  # sem páginas livres: o que se tirou (dados de outros, convites) não fica no ficheiro
        counts = {t: dst.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in ("decks", "tournaments", "rating_games")
                  if dst.execute("SELECT 1 FROM sqlite_master WHERE name=?", (t,)).fetchone()}
        dst.close()
        man = {"app": "grimorio", "format": FORMAT, "level": LEVEL, "needs": NEEDS, "version": app_version(), "created": time.time(),
               "device": device, "scope": "owner" if owner else "all", "owner": owner, "counts": counts, "have": have, **(extra or {})}
        tmpzip = os.path.join(os.path.dirname(dest) or ".", f".{os.path.basename(dest)}.tmp")
        with zipfile.ZipFile(tmpzip, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("manifest.json", json.dumps(man, ensure_ascii=False, indent=1))
            z.write(tmpdb, "grimorio.db")
            cdir = os.path.join(data_dir, "covers")
            for f in sorted(os.listdir(cdir)) if os.path.isdir(cdir) else []:
                if COVER.match(f) and (mine is None or f.split(".")[0] in mine):
                    z.write(os.path.join(cdir, f), f"covers/{f}")
            adir = os.path.join(data_dir, "arts")  # imagens próprias das cartas (pelo conteúdo: podem ir todas)
            for f in sorted(os.listdir(adir)) if os.path.isdir(adir) else []:
                if ART.match(f):
                    z.write(os.path.join(adir, f), f"arts/{f}")
        try:
            os.replace(tmpzip, dest)
        except OSError:
            os.remove(tmpzip)
            raise
        return man
    finally:
        os.remove(tmpdb)


class TooNew(ValueError):
    """A cópia vem de uma versão mais nova que escreve o que esta não sabe juntar: atualizar este aparelho."""
    def __init__(self, version):
        self.version = version or "?"
        super().__init__(f"Estes dados vêm do Grimório {self.version}, mais novo e com coisas que este aparelho ainda não sabe juntar:"
                         f" atualiza este aparelho para a versão {self.version} ou mais recente.")


def check_manifest(man):
    """Recusa (TooNew / ValueError) o que esta versão não sabe juntar sem perder nada."""
    if not isinstance(man, dict) or man.get("app") != "grimorio":
        raise ValueError("Este ficheiro não é uma cópia do Grimório.")
    try:
        fmt, needs = int(man.get("format", 0)), int(man.get("needs", 1))
    except (TypeError, ValueError):
        raise ValueError("Este ficheiro não é uma cópia do Grimório (ou está incompleto).")
    if fmt > FORMAT or needs > LEVEL:
        raise TooNew(str(man.get("version") or ""))


def migrate(con, schema="main"):
    """Cópias de versões antigas: as colunas e tabelas que a junção espera (nunca se perde uma linha por faltarem)."""
    cols = _cols(con, schema, "decks")
    for c, ddl in (("owner", "owner TEXT DEFAULT 'local'"), ("deleted", "deleted REAL")):
        if c not in cols:
            con.execute(f"ALTER TABLE {schema}.decks ADD COLUMN {ddl}")
    con.execute(TOMB.replace("EXISTS tombstones", f"EXISTS {schema}.tombstones"))


def open_zip(path, data_dir):
    """Valida um .grimorio e extrai a base para um temporário -> (manifest, caminho da base, zip aberto)."""
    if not zipfile.is_zipfile(path):
        raise ValueError("Este ficheiro não é uma cópia do Grimório.")
    z = zipfile.ZipFile(path)
    try:
        man = json.loads(z.read("manifest.json"))
        check_manifest(man)
        fd, tmpdb = tempfile.mkstemp(prefix="imp-", suffix=".db", dir=data_dir)
        with os.fdopen(fd, "wb") as f:
            f.write(z.read("grimorio.db"))
        c = sqlite3.connect(tmpdb)
        ok = c.execute("PRAGMA quick_check").fetchone()[0] == "ok" and c.execute("SELECT 1 FROM sqlite_master WHERE name='decks'").fetchone()
        if ok:
            migrate(c)
            c.commit()
        c.close()
        if not ok:
            os.remove(tmpdb)
            raise ValueError("A base de dados dentro da cópia está estragada.")
        return man, tmpdb, z
    except (KeyError, json.JSONDecodeError, zipfile.BadZipFile, sqlite3.DatabaseError, OSError):
        z.close()
        raise ValueError("Este ficheiro não é uma cópia do Grimório (ou está incompleto).")
    except ValueError:
        z.close()
        raise


ART = re.compile(r"^[a-f0-9]{20}\.(?:jpg|png|webp|gif)$")


def _arts(z, data_dir):
    """Imagens próprias das cartas: o nome é o conteúdo, por isso só se juntam as que faltam."""
    adir, n = os.path.join(data_dir, "arts"), 0
    for name in z.namelist():
        f = name[len("arts/"):] if name.startswith("arts/") else ""
        if ART.match(f) and not os.path.exists(os.path.join(adir, f)):
            os.makedirs(adir, exist_ok=True)
            with open(os.path.join(adir, f), "wb") as out:
                out.write(z.read(name))
            n += 1
    return n


def _covers(z, data_dir, owner_ids=None, overwrite=False):
    cdir = os.path.join(data_dir, "covers")
    n = 0
    for name in z.namelist():
        f = name[len("covers/"):] if name.startswith("covers/") else ""
        if not COVER.match(f) or (owner_ids is not None and f.split(".")[0] not in owner_ids):
            continue
        p = os.path.join(cdir, f)
        if overwrite or not os.path.exists(p):
            os.makedirs(cdir, exist_ok=True)
            with open(p, "wb") as out:
                out.write(z.read(name))
            n += 1
    return n


def safety_copy(data_dir, tag="import", min_age=0):
    """Cópia da base antes de juntar: grimorio.db.before-<tag>-<hora>, ficam as KEEP_BACKUPS[tag] mais recentes.
    min_age: não faz outra se a última desta etiqueta tiver menos de min_age segundos (a sincronização junta muitas vezes).
    Devolve o caminho (ou None se não fez)."""
    pre = f"grimorio.db.before-{tag}-"
    old = sorted(f for f in os.listdir(data_dir) if f.startswith(pre) and not f.endswith((".tmp", "-journal")))
    if min_age and old and time.time() - os.path.getmtime(os.path.join(data_dir, old[-1])) < min_age:
        return None
    dest = os.path.join(data_dir, pre + time.strftime("%Y%m%d-%H%M%S"))
    if os.path.exists(dest):
        dest += f"-{uuid.uuid4().hex[:4]}"
    live, b = sqlite3.connect(db_path(data_dir), timeout=30), sqlite3.connect(dest + ".tmp")
    try:
        live.backup(b)
    finally:
        b.close()
        live.close()
    os.replace(dest + ".tmp", dest)
    for f in sorted(f for f in os.listdir(data_dir) if f.startswith(pre) and not f.endswith((".tmp", "-journal")))[:-KEEP_BACKUPS.get(tag, 3)]:
        try:
            os.remove(os.path.join(data_dir, f))
        except OSError:
            pass
    return dest


def reown(con, frm, to, schema="main"):
    """Os dados de `frm` passam a ser de `to` (o dono no servidor e o perfil no aparelho têm nomes diferentes)."""
    if frm == to or frm is None or to is None:
        return
    for t in ("decks", "sim_runs", "tournaments", "bets", "wallets", "ratings", "tombstones"):
        if _has(con, schema, t):
            con.execute(f"UPDATE OR REPLACE {schema}.{t} SET owner=? WHERE owner=?", (to, frm))


def import_file(data_dir, path, mode="merge", owner=None, since=None, keep=True, as_owner=None):
    """Junta (merge) ou substitui (replace) a base com a cópia em `path`. keep = guardar a base atual antes (True: sempre;
    um número: só se a última cópia «sync» tiver mais de tantos segundos). since = hora da última junção com quem fez a cópia
    (sync); por omissão a da própria cópia (sem conflitos: ganha o mais recente). as_owner = os dados do dono da cópia
    (manifest.owner) passam a ser deste dono antes de juntar (servidor ↔ aparelho). Devolve as contagens."""
    if mode == "replace" and owner:
        raise ValueError("Com login só dá para juntar (substituir apagava os dados dos outros).")
    man, tmpdb, z = open_zip(path, data_dir)
    try:
        if as_owner is not None:
            t = sqlite3.connect(tmpdb)
            reown(t, man.get("owner"), as_owner)
            t.commit()
            t.close()
        with LOCK:
            if keep is True:
                safety_copy(data_dir, "import")
            elif keep:
                safety_copy(data_dir, "sync", min_age=keep)
            live = sqlite3.connect(db_path(data_dir), timeout=30)
            if mode == "replace":
                src = sqlite3.connect(tmpdb)
                src.backup(live)
                src.close()
                st = {"replaced": True, "covers": _covers(z, data_dir, overwrite=True), "arts": _arts(z, data_dir)}
            else:
                st = merge(live, tmpdb, man.get("created", 0) if since is None else since, owner)
                mine = {r[0] for r in live.execute("SELECT id FROM decks WHERE owner=?", (owner,))} if owner else None
                st["covers"] = _covers(z, data_dir, mine)
                st["arts"] = _arts(z, data_dir)
            live.commit()
            live.close()
        return {**st, "from": {k: man.get(k) for k in ("created", "device", "counts", "version", "level")}}
    finally:
        z.close()
        os.remove(tmpdb)


# ---------- junção ----------

def _cols(con, schema, table):
    return [r[1] for r in con.execute(f"PRAGMA {schema}.table_info({table})")]


def _has(con, schema, table):
    return bool(con.execute(f"SELECT 1 FROM {schema}.sqlite_master WHERE type='table' AND name=?", (table,)).fetchone())


def _union(con, table, keys, where="1", args=()):
    """Copia de r.table as linhas que ainda não existem (iguais nas colunas `keys`); o id inteiro é novo."""
    c = [x for x in _cols(con, "main", table) if x in _cols(con, "r", table) and x != "id"]
    same = " AND ".join(f"l.{k} IS x.{k}" for k in keys)
    return con.execute(f"INSERT INTO main.{table} ({','.join(c)}) SELECT {','.join('x.' + k for k in c)} FROM r.{table} AS x"
                       f" WHERE ({where}) AND NOT EXISTS (SELECT 1 FROM main.{table} AS l WHERE {same})", args).rowcount


def _body(b):
    d = json.loads(b or "{}")
    d.pop("updated", None)
    return d


def _copy(con, row):
    """Cópia «(conflito)» do deck que perdeu: id fixo a partir do id e da hora da alteração (igual nos dois aparelhos)."""
    did, name, fmt, body, upd, own = row[:6]
    cid = str(uuid.uuid5(uuid.NAMESPACE_URL, f"grimorio-conflict:{did}:{upd}"))
    d = json.loads(body or "{}")
    d.update(id=cid, name=f"{name} (conflito)", conflict_of=did)
    n = con.execute("INSERT OR IGNORE INTO decks (id, name, format, body, updated, owner, deleted) VALUES (?,?,?,?,?,?,NULL)",
                    (cid, d["name"][:200], fmt, json.dumps(d, ensure_ascii=False), upd, own)).rowcount
    return d["name"] if n else None


BET_KEY = ("owner", "tid", "kind", "mid", "pick", "ts")  # os ids inteiros colidem entre aparelhos: compara-se o conteúdo


SYNC_TABLES = ("decks", "sim_runs", "sim_games", "profiles", "tournaments", "tournament_games", "wallets", "bets", "ratings",
               "rating_games", "ratings_kv", "tombstones")


def tomb(con, kind, rid, owner, ts=None, data=None):
    """Marca uma linha apagada de vez (KINDS). data = o que se apagou (JSON), para repor durante UNDO_DAYS."""
    con.execute(TOMB)
    blob = zlib.compress(json.dumps(data, ensure_ascii=False, default=str).encode(), 6) if data is not None else None
    con.execute("INSERT INTO tombstones (kind, id, owner, ts, revived, data) VALUES (?,?,?,?,NULL,?) ON CONFLICT(kind, id) DO UPDATE SET"
                " ts=max(coalesce(ts, 0), excluded.ts), owner=excluded.owner, data=coalesce(excluded.data, data)",
                (kind, str(rid), owner, ts or time.time(), blob))
    con.execute("UPDATE tombstones SET data=NULL WHERE data IS NOT NULL AND ts < ?", (time.time() - UNDO_DAYS * 86400,))


def _dead(con, owner=None):
    """{(kind, id): (hora, dono)} das marcas em vigor (apagado depois da última reposição)."""
    if not _has(con, "main", "tombstones"):
        return {}
    return {(k, i): (ts, o) for k, i, ts, o in con.execute("SELECT kind, id, ts, owner FROM main.tombstones WHERE ts > coalesce(revived, 0)"
                                                           " AND (? IS NULL OR owner=?)", (owner, owner))}


def apply_tombs(con, owner=None):
    """Apaga as linhas locais com uma marca em vigor que não mudaram depois de apagadas. Devolve quantas."""
    n = 0
    for (kind, rid), (ts, own) in _dead(con, owner).items():
        if kind not in KINDS:
            continue  # um tipo que esta versão não conhece: a marca fica (viaja) mas não se aplica
        table, chg = KINDS[kind]
        if not _has(con, "main", table):
            continue
        row = con.execute(f"SELECT {chg}, {'id' if kind == 'profile' else 'owner'} FROM main.{table} WHERE id=?", (rid,)).fetchone()
        if not row or row[0] > ts or row[1] != own:
            continue
        if kind == "tournament":
            con.execute("DELETE FROM main.tournament_games WHERE tid=?", (rid,))
            if _has(con, "main", "bets"):
                con.execute("DELETE FROM main.bets WHERE tid=?", (rid,))
        n += con.execute(f"DELETE FROM main.{table} WHERE id=?", (rid,)).rowcount
    return n


def merge(con, src_path, since=0.0, owner=None):
    """Junta a base em src_path na base de `con` (regras no topo do ficheiro). owner = só linhas desse dono (e nunca toca
    nas linhas de outro dono com o mesmo id)."""
    st = {"decks_new": 0, "decks_updated": 0, "conflicts": [], "tournaments": 0, "games": 0, "rating_games": 0, "deleted": 0}
    con.execute("ATTACH DATABASE ? AS r", (src_path,))
    try:
        mine = (lambda o: owner is None or o == owner)
        for t in SYNC_TABLES:  # uma tabela que este aparelho ainda não criou: cria-se igual à da cópia (nada se perde)
            if _has(con, "r", t) and not _has(con, "main", t):
                sql = con.execute("SELECT sql FROM r.sqlite_master WHERE type='table' AND name=?", (t,)).fetchone()[0]
                con.execute(re.sub(r'^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"?\w+"?', f"CREATE TABLE main.{t}", sql, count=1))
        migrate(con)
        # apagados: as marcas juntam-se primeiro (a mais recente de cada lado), para não entrar o que um lado já apagou
        if _has(con, "r", "tombstones"):
            for kind, rid, own, ts, rev in con.execute("SELECT kind, id, owner, ts, revived FROM r.tombstones").fetchall():
                if mine(own) and kind and rid:
                    con.execute("INSERT INTO main.tombstones (kind, id, owner, ts, revived) VALUES (?,?,?,?,?) ON CONFLICT(kind, id) DO UPDATE SET"
                                " ts=max(coalesce(ts, 0), coalesce(excluded.ts, 0)), revived=nullif(max(coalesce(revived, 0), coalesce(excluded.revived, 0)), 0)"
                                " WHERE owner IS excluded.owner", (kind, rid, own, ts or 0, rev))
        dead = _dead(con, owner)

        def gone(kind, rid, own, t):
            d = dead.get((kind, rid))
            return bool(d) and d[1] == own and (t or 0) <= d[0]
        # decks (os dos amigos são desta instalação: não entram)
        for row in con.execute("SELECT id, name, format, body, updated, owner, deleted FROM r.decks"
                               " WHERE json_extract(body, '$.friend') IS NULL").fetchall():
            if not mine(row[5]) or gone("deck", row[0], row[5], max(row[4] or 0, row[6] or 0)):
                continue
            loc = con.execute("SELECT id, name, format, body, updated, owner, deleted FROM main.decks WHERE id=?", (row[0],)).fetchone()
            if not loc:
                con.execute("INSERT INTO main.decks (id, name, format, body, updated, owner, deleted) VALUES (?,?,?,?,?,?,?)", row)
                st["decks_new"] += 1
                continue
            if loc[5] != row[5] or json.loads(loc[3] or "{}").get("friend"):
                continue  # o mesmo id com outro dono (ou um deck de amigo daqui): nunca se mexe
            if _body(loc[3]) == _body(row[3]) and bool(loc[6]) == bool(row[6]):
                continue
            lc, rc = max(loc[4] or 0, loc[6] or 0), max(row[4] or 0, row[6] or 0)
            both = not since or (lc > since and rc > since)
            win, lose = (row, loc) if rc > lc else (loc, row)
            if both and not lose[6]:  # o perdedor no lixo não precisa de cópia
                n = _copy(con, lose)
                if n:
                    st["conflicts"].append(n)
            if win is row:
                con.execute("UPDATE main.decks SET name=?, format=?, body=?, updated=?, owner=?, deleted=? WHERE id=?", (*row[1:], row[0]))
                st["decks_updated"] += 1
        # perfis, sessões e jogos do Laboratório
        if owner is None and _has(con, "r", "profiles"):
            c = ",".join(x for x in _cols(con, "main", "profiles") if x in _cols(con, "r", "profiles"))
            con.execute(f"INSERT OR IGNORE INTO main.profiles ({c}) SELECT {c} FROM r.profiles")
        if _has(con, "r", "sim_runs"):
            c = ",".join(x for x in _cols(con, "main", "sim_runs") if x in _cols(con, "r", "sim_runs"))
            con.execute(f"INSERT OR IGNORE INTO main.sim_runs ({c}) SELECT {c} FROM r.sim_runs WHERE ? IS NULL OR owner=?", (owner, owner))
        if _has(con, "r", "sim_games"):
            _union(con, "sim_games", ("ts", "deck_id", "game_no", "match_id"),
                   "? IS NULL OR deck_id IN (SELECT id FROM main.decks WHERE owner=?)", (owner, owner))
        # torneios (com os jogos e as apostas da versão que fica)
        if _has(con, "r", "tournaments") and _has(con, "main", "tournaments"):
            def prog(schema, tid, status):
                return (status in ("done", "cancelled", "error"),
                        con.execute(f"SELECT COUNT(*) FROM {schema}.tournament_games WHERE tid=?", (tid,)).fetchone()[0])
            rcols = set(_cols(con, "r", "tournaments"))
            tc = [c for c in _cols(con, "main", "tournaments") if c in rcols]
            for row in con.execute(f"SELECT {','.join(tc)} FROM r.tournaments").fetchall():
                t = dict(zip(tc, row))
                if not mine(t.get("owner")) or gone("tournament", t["id"], t.get("owner"), t.get("ts")):
                    continue
                loc = con.execute("SELECT status, owner FROM main.tournaments WHERE id=?", (t["id"],)).fetchone()
                if loc and (loc[1] != t.get("owner") or prog("main", t["id"], loc[0]) >= prog("r", t["id"], t["status"])):
                    continue
                state, remap = json.loads(t["state"]), {}
                con.execute("DELETE FROM main.tournament_games WHERE tid=?", (t["id"],))
                for gid, ts, game in con.execute("SELECT id, ts, game FROM r.tournament_games WHERE tid=? ORDER BY id", (t["id"],)).fetchall():
                    free = not con.execute("SELECT 1 FROM main.tournament_games WHERE id=?", (gid,)).fetchone()
                    new = con.execute("INSERT INTO main.tournament_games (id, tid, ts, game) VALUES (?,?,?,?)",
                                      (gid if free else None, t["id"], ts, game)).lastrowid
                    if new != gid:
                        remap[gid] = new
                    st["games"] += 1
                for m in state.get("matches", []):  # o estado aponta para os jogos pelo id
                    for g in m.get("g", []):
                        if g.get("id") in remap:
                            g["id"] = remap[g["id"]]
                if t["status"] in ("running", "paused"):  # só um aparelho joga cada torneio
                    t["status"] = "paused"
                t["state"] = json.dumps(state, ensure_ascii=False)
                if loc:
                    con.execute(f"UPDATE main.tournaments SET {','.join(c + '=?' for c in tc)} WHERE id=?", [t[c] for c in tc] + [t["id"]])
                else:
                    con.execute(f"INSERT INTO main.tournaments ({','.join(tc)}) VALUES ({','.join('?' * len(tc))})", [t[c] for c in tc])
                if _has(con, "r", "bets") and _has(con, "main", "bets"):
                    con.execute("DELETE FROM main.bets WHERE tid=?", (t["id"],))
                    _union(con, "bets", BET_KEY, "tid=? AND (? IS NULL OR owner=?)", (t["id"], owner, owner))
                st["tournaments"] += 1
            if _has(con, "r", "bets") and _has(con, "main", "bets"):  # apostas de torneios que não mudaram de versão
                _union(con, "bets", BET_KEY, "(? IS NULL OR owner=?) AND tid IN (SELECT id FROM main.tournaments WHERE ? IS NULL OR owner=?)",
                       (owner, owner, owner, owner))
        if _has(con, "r", "wallets") and _has(con, "main", "wallets"):
            for own, coins, sub in con.execute("SELECT owner, coins, subsidy FROM r.wallets").fetchall():
                if mine(own):
                    con.execute("INSERT INTO main.wallets VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET coins=max(coins, excluded.coins),"
                                " subsidy=max(coalesce(subsidy, ''), coalesce(excluded.subsidy, ''))", (own, coins, sub))
        # ratings: jogos pelo conteúdo, linhas que faltam (nomes) e depois refazer tudo. Com dono: só o que toca nos decks dele
        if _has(con, "r", "rating_games") and _has(con, "main", "rating_games"):
            keys = "(SELECT 'deck:' || id FROM main.decks WHERE owner=?)"
            st["rating_games"] = _union(con, "rating_games", ("round_id", "ts", "a_key", "b_key", "winner"),
                                        f"? IS NULL OR a_key IN {keys} OR b_key IN {keys}", (owner, owner, owner))
            n = 0
            if _has(con, "r", "ratings"):
                c = ",".join(x for x in _cols(con, "main", "ratings") if x in _cols(con, "r", "ratings"))
                n = con.execute(f"INSERT OR IGNORE INTO main.ratings ({c}) SELECT {c} FROM r.ratings WHERE ? IS NULL OR key IN {keys}",
                                (owner, owner)).rowcount
            if _has(con, "r", "ratings_kv"):
                for k, v in con.execute("SELECT k, v FROM r.ratings_kv WHERE k LIKE 'reset:%' OR k='arena_played'").fetchall():
                    if owner is not None and not con.execute("SELECT 1 FROM main.decks WHERE 'reset:deck:' || id = ? AND owner=?", (k, owner)).fetchone():
                        continue
                    old = con.execute("SELECT v FROM main.ratings_kv WHERE k=?", (k,)).fetchone()
                    if not old or json.loads(v) > json.loads(old[0]):
                        con.execute("INSERT OR REPLACE INTO main.ratings_kv VALUES (?,?)", (k, v))
                        n += 1
            if st["rating_games"] or n:
                rebuild_ratings(con)
        st["deleted"] = apply_tombs(con, owner)  # sessões, perfis e o que cá estava e o outro lado apagou
        con.commit()
    except BaseException:
        con.rollback()
        raise
    finally:
        con.execute("DETACH DATABASE r")
    return st


def rebuild_ratings(con):
    """Refaz a tabela ratings (Elo, jogos, vitórias, rondas) a partir de rating_games, pela ordem do tempo, com as regras
    de ratings.record_round; os jogos de antes de um recomeço (ratings_kv reset:<chave>) contam para o adversário mas
    não para o deck que recomeçou. Também acerta a_elo/b_elo (a curva do Elo)."""
    # ponytail: conta todas as rondas com jogos, também as que a Arena ainda não fechou (diferença até a ronda acabar)
    R = {k[6:]: json.loads(v) for k, v in con.execute("SELECT k, v FROM ratings_kv WHERE k LIKE 'reset:%'")}
    meta = {(k, f): (kind, own, name) for k, f, kind, own, name in con.execute("SELECT key, format, kind, owner, name FROM ratings")}
    S, rounds = {}, {}
    for gid, ts, fmt, ak, bk, w, rid in con.execute("SELECT id, ts, format, a_key, b_key, winner, round_id FROM rating_games ORDER BY ts, id").fetchall():
        ka, kb = (k + "@antes" if k in R and (ts or 0) < R[k] else k for k in (ak, bk))
        ra, rb = S.setdefault((ka, fmt), [ratings.START, 0, 0, 0, 0]), S.setdefault((kb, fmt), [ratings.START, 0, 0, 0, 0])
        if w in ("a", "b", "draw"):
            s = 1.0 if w == "a" else 0.0 if w == "b" else 0.5
            x = ratings.expected(ra[0], rb[0])
            ra[0], rb[0] = (ra[0] + (ratings.K_PROV if ra[1] < ratings.PROV else ratings.K) * (s - x),
                            rb[0] + (ratings.K_PROV if rb[1] < ratings.PROV else ratings.K) * (x - s))
            for r, win, loss in ((ra, w == "a", w == "b"), (rb, w == "b", w == "a")):
                r[1] += 1
                r[2] += win
                r[3] += loss
                r[4] += w == "draw"
            con.execute("UPDATE rating_games SET a_elo=?, b_elo=? WHERE id=?", (ra[0], rb[0], gid))
            t = rounds.setdefault(rid, {"fmt": fmt, "w": {ka: 0, kb: 0}})
            if w != "draw":
                t["w"][ka if w == "a" else kb] = t["w"].get(ka if w == "a" else kb, 0) + 1
    con.execute("DELETE FROM ratings")
    rd = {}
    for t in rounds.values():
        (k1, w1), (k2, w2) = list(t["w"].items())[:2]
        for k, me, op in ((k1, w1, w2), (k2, w2, w1)):
            x = rd.setdefault((k, t["fmt"]), [0, 0, 0])
            x[0] += 1
            x[1] += me > op
            x[2] += op > me
    now = time.time()
    for (k, f), (elo, g, wi, lo, dr) in S.items():
        if k.endswith("@antes"):
            continue
        kind, own, name = meta.get((k, f)) or ("meu" if k.startswith("deck:") else "meta", "", k)
        if (k, f) not in meta and k.startswith("deck:"):
            r = con.execute("SELECT owner, name FROM decks WHERE id=?", (k[5:],)).fetchone()
            own, name = r or (own, name)
        ro, rw, rl = rd.get((k, f), (0, 0, 0))
        con.execute("INSERT INTO ratings VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (k, f, kind, own or "", name, elo, g, wi, lo, dr, ro, rw, rl, now))


# ---------- conflitos e apagados (Definições › Dados) ----------

CONFLICT_SUFFIX = " (conflito)"


def _cards(d):
    """{carta: n} do deck (sideboard com «SB: », comandantes com n=1)."""
    out = {n: q for n, q in (d.get("main") or {}).items() if isinstance(q, int)}
    out.update({f"SB: {n}": q for n, q in (d.get("side") or {}).items() if isinstance(q, int)})
    out.update({f"★ {n}": 1 for n in d.get("commanders") or [] if isinstance(n, str)})
    return out


def _diff(a, b):
    """O que muda de a para b: [[carta, +n/-n]] (as maiores diferenças primeiro, até 12)."""
    ca, cb = _cards(a), _cards(b)
    out = [[n, cb.get(n, 0) - ca.get(n, 0)] for n in set(ca) | set(cb) if cb.get(n, 0) != ca.get(n, 0)]
    return sorted(out, key=lambda x: (-abs(x[1]), x[0]))[:12]


def _side(d, upd, deleted=None):
    return {"name": d.get("name"), "format": d.get("format"), "updated": upd, "deleted": deleted,
            "cards": sum(q for q in (d.get("main") or {}).values() if isinstance(q, int)) + len(d.get("commanders") or [])}


def conflicts(con, owner):
    """As cópias «(conflito)» por resolver do dono: [{id, at, mine: a versão que ficou, other: a do conflito, diff}]."""
    out = []
    for cid, body, upd in con.execute("SELECT id, body, updated FROM decks WHERE owner IS ? AND deleted IS NULL"
                                      " AND json_extract(body, '$.conflict_of') IS NOT NULL ORDER BY updated DESC", (owner,)).fetchall():
        c = json.loads(body)
        o = con.execute("SELECT body, updated, deleted FROM decks WHERE id=? AND owner IS ?", (c["conflict_of"], owner)).fetchone()
        od = json.loads(o[0]) if o else {}
        out.append({"id": cid, "orig": c["conflict_of"], "other": _side(c, upd), "mine": _side(od, o[1], o[2]) if o else None,
                    "diff": _diff(od, c)})
    return out


def resolve(con, owner, cid, keep):
    """keep: 'mine' (fica a versão atual; a cópia vai para o lixo), 'other' (a versão do conflito passa para o deck original
    e a cópia vai para o lixo) ou 'both' (a cópia fica como um deck à parte, sem a marca). Tudo são alterações normais (com
    hora): viajam para os outros aparelhos e não criam conflitos novos."""
    r = con.execute("SELECT body FROM decks WHERE id=? AND owner IS ? AND deleted IS NULL", (cid, owner)).fetchone()
    c = json.loads(r[0]) if r else {}
    if not c.get("conflict_of") or keep not in ("mine", "other", "both"):
        raise ValueError("Esse conflito já não existe.")
    now = time.time()
    if keep == "both":
        c.pop("conflict_of", None)
        nm = str(c.get("name") or "")
        c["name"] = (nm[:-len(CONFLICT_SUFFIX)] if nm.endswith(CONFLICT_SUFFIX) else nm) + " (2)"
        c["updated"] = now
        con.execute("UPDATE decks SET name=?, body=?, updated=? WHERE id=?", (c["name"][:200], json.dumps(c, ensure_ascii=False), now, cid))
        return {"ok": True, "id": cid}
    if keep == "other":
        oid = c.pop("conflict_of")
        o = con.execute("SELECT body, owner FROM decks WHERE id=?", (oid,)).fetchone()
        if o and o[1] != owner:
            raise ValueError("Esse conflito já não existe.")
        old = json.loads(o[0]) if o else {}
        nm = str(c.get("name") or "")
        c.update(id=oid, name=nm[:-len(CONFLICT_SUFFIX)] if nm.endswith(CONFLICT_SUFFIX) else nm, updated=now)
        for k in ("created", "rated"):  # a data de criação e a lista dos ratings são do deck original
            if k in old:
                c[k] = old[k]
        con.execute("INSERT OR REPLACE INTO decks (id, name, format, body, updated, owner, deleted) VALUES (?,?,?,?,?,?,NULL)",
                    (oid, c["name"][:200], str(c.get("format") or "")[:40], json.dumps(c, ensure_ascii=False), now, owner))
    con.execute("UPDATE decks SET deleted=? WHERE id=?", (now, cid))
    return {"ok": True}


def deleted(con, owner):
    """Apagados de vez nos últimos UNDO_DAYS dias que ainda se podem repor (torneios, sessões de testes, perfis)."""
    if not _has(con, "main", "tombstones"):
        return []
    out = []
    for kind, rid, ts, data in con.execute("SELECT kind, id, ts, data FROM tombstones WHERE data IS NOT NULL AND ts > coalesce(revived, 0)"
                                           " AND owner IS ? AND ts > ? ORDER BY ts DESC LIMIT 60", (owner, time.time() - UNDO_DAYS * 86400)):
        try:
            d = json.loads(zlib.decompress(data))
        except (zlib.error, ValueError):
            continue
        row = d.get("row") or {}
        out.append({"kind": kind, "id": rid, "at": ts, "name": row.get("name") or row.get("label") or rid,
                    "games": len(d.get("games") or [])})
    return out


def restore(con, owner, kind, rid):
    """Repõe um apagado (deleted()): a linha volta e a marca fica «reposta» (revived), para viajar também."""
    r = con.execute("SELECT data FROM tombstones WHERE kind=? AND id=? AND owner IS ? AND data IS NOT NULL", (kind, rid, owner)).fetchone() \
        if _has(con, "main", "tombstones") else None
    if not r or kind not in KINDS:
        raise ValueError("Já não dá para repor isto.")
    d = json.loads(zlib.decompress(r[0]))
    row, table = d.get("row") or {}, KINDS[kind][0]
    cols = [c for c in _cols(con, "main", table) if c in row]
    if kind == "tournament" and row.get("status") not in ("done", "cancelled", "error"):
        row["status"] = "cancelled"  # as apostas já foram devolvidas ao apagar: volta como cancelado (para rever)
    if con.execute(f"SELECT 1 FROM {table} WHERE id=?", (rid,)).fetchone():
        raise ValueError("Já existe outra vez.")
    if kind == "tournament":
        import base64
        st, remap = json.loads(row.get("state") or "{}"), {}
        for gid, ts, game in d.get("games") or []:
            free = not con.execute("SELECT 1 FROM tournament_games WHERE id=?", (gid,)).fetchone()
            new = con.execute("INSERT INTO tournament_games (id, tid, ts, game) VALUES (?,?,?,?)", (gid if free else None, rid, ts, base64.b64decode(game))).lastrowid
            if new != gid:
                remap[gid] = new
        for m in st.get("matches", []):
            for g in m.get("g", []):
                if g.get("id") in remap:
                    g["id"] = remap[g["id"]]
        row["state"] = json.dumps(st, ensure_ascii=False)
    con.execute(f"INSERT INTO {table} ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})", [row[c] for c in cols])
    con.execute("UPDATE tombstones SET revived=?, data=NULL WHERE kind=? AND id=?", (time.time(), kind, rid))
    return {"ok": True}


def deleted_tournament(con, tid):
    """O que se guarda de um torneio apagado (para repor): a linha e os jogos."""
    import base64
    tc = _cols(con, "main", "tournaments")
    r = con.execute(f"SELECT {','.join(tc)} FROM tournaments WHERE id=?", (tid,)).fetchone()
    if not r:
        return None
    return {"row": dict(zip(tc, r)), "games": [[i, ts, base64.b64encode(g).decode()] for i, ts, g in
                                              con.execute("SELECT id, ts, game FROM tournament_games WHERE tid=? ORDER BY id", (tid,))]}


def row_of(con, table, rid):
    c = _cols(con, "main", table)
    r = con.execute(f"SELECT {','.join(c)} FROM {table} WHERE id=?", (rid,)).fetchone()
    return {"row": dict(zip(c, r))} if r else None


# ---------- sincronização por pasta ----------

def _cfg_path(data_dir):
    return os.path.join(data_dir, "sync.json")


def load(data_dir):
    try:
        with open(_cfg_path(data_dir), encoding="utf-8") as f:
            c = json.load(f)
    except (OSError, ValueError):
        c = {}
    if not c.get("device"):  # nome do aparelho no ficheiro da pasta: o do computador + 4 letras (dois iguais não colidem)
        host = re.sub(r"[^a-z0-9]+", "-", socket.gethostname().lower()).strip("-")[:20] or "pc"
        c["device"] = f"{host}-{uuid.uuid4().hex[:4]}"
    return {"on": False, "folder": "", "seen": {}, "since": {}, "conflicts": [], **c}


def save(data_dir, c):
    tmp = _cfg_path(data_dir) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(c, f, ensure_ascii=False, indent=1)
    os.replace(tmp, _cfg_path(data_dir))


def fingerprint(data_dir, owner=None):
    """Muda quando algo que vale a pena levar muda (decks, torneios, jogos, apostas, testes, perfis, apagados).
    owner = só o que é desse dono (sincronização com um servidor)."""
    con = sqlite3.connect(db_path(data_dir), timeout=30)
    out = []
    w = "WHERE owner IS ?" if owner is not None else "WHERE ? IS NULL"
    for q in (f"SELECT COUNT(*), max(updated), max(deleted) FROM decks {w}", f"SELECT COUNT(*), group_concat(status) FROM tournaments {w}",
              f"SELECT max(id), COUNT(*) FROM tournament_games WHERE tid IN (SELECT id FROM tournaments {w})", "SELECT COUNT(*), max(id) FROM rating_games WHERE ?1 IS ?1",
              f"SELECT COUNT(*), sum(stake), group_concat(status) FROM bets {w}", f"SELECT sum(coins) FROM wallets {w}", f"SELECT COUNT(*) FROM sim_runs {w}",
              "SELECT COUNT(*) FROM sim_games WHERE ?1 IS ?1", "SELECT COUNT(*), group_concat(name) FROM profiles WHERE ?1 IS NULL",
              f"SELECT COUNT(*), max(ts), max(revived) FROM tombstones {w}"):
        try:
            out.append(con.execute(q, (owner,)).fetchone())
        except sqlite3.OperationalError:
            out.append(None)
    con.close()
    return json.dumps(out)


def folder_of(c):
    return os.path.expanduser(os.path.expandvars(str(c.get("folder") or "").strip()))


def tick(data_dir, force=False):
    """Uma volta: junta os ficheiros dos outros aparelhos que mudaram e escreve o deste se algo mudou."""
    with LOCK:
        c = load(data_dir)
        if not c["on"]:
            return c
        folder = folder_of(c)
        if not folder or not os.path.isdir(folder):
            c["error"] = "A pasta não existe (ou o disco da nuvem não está ligado)."
            save(data_dir, c)
            return c
        c["error"] = c["newer"] = None
        mine = f"grimorio-{c['device']}.grimorio"
        for f in sorted(os.listdir(folder)):
            if not (f.startswith("grimorio-") and f.endswith(".grimorio")) or f == mine:
                continue
            p = os.path.join(folder, f)
            mt = os.path.getmtime(p)
            if c["seen"].get(f, 0) >= mt:
                continue
            dev = f[len("grimorio-"):-len(".grimorio")]
            try:
                # cópia de segurança antes de juntar (grimorio.db.before-sync-<hora>: no máximo uma por hora, ficam as 3 últimas)
                st = import_file(data_dir, p, "merge", since=c["since"].get(dev, 0), keep=3600)
            except TooNew as e:  # outro aparelho já tem uma versão mais nova: o ficheiro dele fica à espera desta atualizar
                c["error"], c["newer"] = str(e), e.version
                continue
            except ValueError as e:  # a app de sync ainda está a descarregar: tenta na próxima volta
                c["error"] = f"{f}: {e}"
                continue
            c["seen"][f], c["since"][dev] = mt, time.time()
            c["last_pull"] = {"at": time.time(), "device": dev, **{k: st[k] for k in ("decks_new", "decks_updated", "tournaments", "rating_games")}}
            c["conflicts"] = (c["conflicts"] + [{"at": time.time(), "device": dev, "deck": n} for n in st["conflicts"]])[-20:]
        fp = fingerprint(data_dir)
        if force or fp != c.get("fp") or not os.path.exists(os.path.join(folder, mine)):
            try:
                snapshot(data_dir, os.path.join(folder, mine), device=c["device"], scrub=True)
                c["fp"], c["last_push"] = fp, time.time()
            except OSError as e:  # p.ex. a app de sync tem o ficheiro aberto (Windows): tenta na próxima volta
                c["error"] = f"Não consegui escrever na pasta: {e}"
        save(data_dir, c)
        return c


def _loop(data_dir):
    while True:
        time.sleep(TICK)
        try:
            tick(data_dir)
        except Exception as e:  # a sincronização é um extra: nunca derruba o servidor
            print(f"[sync] {e!r}", file=sys.stderr, flush=True)


def init(data_dir):
    global DATA
    DATA = data_dir
    threading.Thread(target=_loop, args=(data_dir,), daemon=True).start()
    atexit.register(lambda: load(data_dir)["on"] and tick(data_dir))  # ao fechar: leva o que mudou
    if load(data_dir)["on"]:
        threading.Thread(target=tick, args=(data_dir,), daemon=True).start()  # ao abrir: traz o que mudou


def candidates():
    """Pastas de apps de nuvem que existem neste computador (sugestões para a escolha da pasta)."""
    h = os.path.expanduser("~")
    opts = [("Google Drive", p) for p in (os.path.join(h, "Google Drive", "My Drive"), os.path.join(h, "My Drive"), os.path.join(h, "GoogleDrive"),
                                         os.path.join(h, "Google Drive"), "G:\\My Drive", "G:\\O meu disco", "G:\\Mi unidad")]
    opts += [("OneDrive", os.environ.get("OneDrive") or os.path.join(h, "OneDrive")), ("Dropbox", os.path.join(h, "Dropbox")),
             ("Syncthing", os.path.join(h, "Sync")), ("Nextcloud", os.path.join(h, "Nextcloud")),
             ("iCloud Drive", os.path.join(h, "Library", "Mobile Documents", "com~apple~CloudDocs"))]
    seen, out = set(), []
    for name, p in opts:
        if p and os.path.isdir(p) and p not in seen:
            seen.add(p)
            out.append({"app": name, "folder": os.path.join(p, "Grimorio")})
    return out


def status(data_dir):
    c = load(data_dir)
    folder = folder_of(c)
    files = sorted(f for f in os.listdir(folder) if f.startswith("grimorio-") and f.endswith(".grimorio")) if folder and os.path.isdir(folder) else []
    return {**{k: c.get(k) for k in ("on", "folder", "device", "last_push", "last_pull", "conflicts", "error", "newer")},
            "devices": [f[len("grimorio-"):-len(".grimorio")] for f in files], "candidates": candidates()}


# ---------- HTTP (chamado por server.py) ----------

def http(h, method, path, data_dir):
    """/api/backup/export (GET), /api/backup/import?mode=merge|replace (POST, corpo = o ficheiro), /api/sync (GET estado,
    POST {on, folder}), /api/sync/now (POST). Modo login: só os dados do próprio, sem substituir nem pasta."""
    login, owner = h.mode() == "login", h.owner()
    who = owner if login else None
    if method == "GET" and path == "/api/backup/export":
        fd, tmp = tempfile.mkstemp(prefix="exp-", suffix=".grimorio", dir=data_dir)
        os.close(fd)
        try:
            snapshot(data_dir, tmp, owner=who, device=load(data_dir)["device"])
            with open(tmp, "rb") as f:
                body = f.read()
        finally:
            os.remove(tmp)
        name = f"grimorio-backup-{time.strftime('%Y-%m-%d')}.grimorio"
        return h.send(200, body, "application/octet-stream", {"Content-Disposition": f'attachment; filename="{name}"'})
    if method == "POST" and path.split("?")[0] == "/api/backup/import":
        mode = "replace" if "mode=replace" in path else "merge"
        n = int(h.headers.get("Content-Length") or 0)
        if not 0 < n <= 500_000_000:
            return h.json({"erro": "Escolhe um ficheiro .grimorio (até 500 MB)."}, 400)
        fd, tmp = tempfile.mkstemp(prefix="up-", suffix=".grimorio", dir=data_dir)
        try:
            with os.fdopen(fd, "wb") as f:
                left = n
                while left:
                    chunk = h.rfile.read(min(left, 1 << 20))
                    if not chunk:
                        break
                    f.write(chunk)
                    left -= len(chunk)
            return h.json(import_file(data_dir, tmp, mode, owner=who))
        except ValueError as e:
            return h.json({"erro": str(e)}, 400)
        finally:
            os.remove(tmp)
    if path.startswith("/api/sync"):
        if login:
            return h.json({"erro": "A sincronização por pasta é das instalações sem login (computador ou servidor de um dono)."}, 403)
        if method == "GET" and path == "/api/sync":
            return h.json(status(data_dir))
        if method == "POST" and path == "/api/sync":
            try:
                d = json.loads(h.rfile.read(int(h.headers.get("Content-Length") or 0)) or b"{}")
                with LOCK:
                    c = load(data_dir)
                    if "folder" in d:
                        folder = os.path.expanduser(os.path.expandvars(str(d["folder"] or "").strip()))
                        if folder and not os.path.isdir(folder):
                            os.makedirs(folder, exist_ok=True)  # a pasta «Grimorio» dentro da do Drive/Dropbox…
                        if folder != folder_of(c):
                            c.update(folder=str(d["folder"]).strip(), seen={}, since={}, fp=None)  # pasta nova: juntar tudo de novo
                    if "on" in d:
                        c["on"] = bool(d["on"]) and bool(folder_of(c))
                    save(data_dir, c)
                if c["on"]:
                    tick(data_dir, force=True)
                return h.json(status(data_dir))
            except (OSError, ValueError, TypeError) as e:
                return h.json({"erro": f"Não consegui usar essa pasta: {e}"}, 400)
        if method == "POST" and path == "/api/sync/now":
            try:
                tick(data_dir, force=True)
            except (OSError, ValueError) as e:
                return h.json({"erro": str(e)}, 400)
            return h.json(status(data_dir))
    return h.json({"erro": "rota desconhecida"}, 404)


# ---------- verificação ----------

DDL = ["CREATE TABLE decks (id TEXT PRIMARY KEY, name TEXT, format TEXT, body TEXT NOT NULL, updated REAL NOT NULL, owner TEXT, deleted REAL)",
       "CREATE TABLE sim_games (id INTEGER PRIMARY KEY, ts REAL, deck_id TEXT, deck_name TEXT, format TEXT, opp_name TEXT, opp_archetype TEXT,"
       " game_no INTEGER, match_id TEXT, winner TEXT, turns INTEGER, a_side_in TEXT, a_side_out TEXT, summary TEXT)",
       "CREATE TABLE sim_runs (id TEXT PRIMARY KEY, deck_id TEXT, owner TEXT, ts REAL, label TEXT, summary TEXT, body TEXT NOT NULL)",
       "CREATE TABLE profiles (id TEXT PRIMARY KEY, name TEXT, color TEXT, created REAL)",
       "CREATE TABLE tournaments (id TEXT PRIMARY KEY, owner TEXT, ts REAL, name TEXT, type TEXT, format TEXT, status TEXT, champion TEXT, n INTEGER, state TEXT NOT NULL)",
       "CREATE TABLE tournament_games (id INTEGER PRIMARY KEY, tid TEXT, ts REAL, game BLOB)",
       "CREATE TABLE wallets (owner TEXT PRIMARY KEY, coins INTEGER, subsidy TEXT)",
       "CREATE TABLE bets (id INTEGER PRIMARY KEY, owner TEXT, tid TEXT, kind TEXT, mid TEXT, pick INTEGER, stake INTEGER, odds REAL, ts REAL, status TEXT, payout INTEGER)"]


def selfcheck():
    """`python3 -c "import backup; backup.selfcheck()"`: dois aparelhos a mexer sem rede e depois a juntar."""
    tmp = tempfile.mkdtemp(prefix="grim-sync-")
    try:
        def dev(name):
            d = os.path.join(tmp, name)
            os.makedirs(d)
            c = ratings.schema(sqlite3.connect(db_path(d)))
            for s in DDL:
                c.execute(s)
            return d, c
        A, ca = dev("a")
        deck = lambda i, name, t, main: (i, name, "modern", json.dumps({"id": i, "name": name, "main": main, "updated": t}), t, "eu", None)  # noqa: E731
        for d in (deck("x", "X", 100, {"Forest": 4}), deck("y", "Y", 100, {"Island": 4}), deck("w", "W", 100, {"Swamp": 4})):
            ca.execute("INSERT INTO decks VALUES (?,?,?,?,?,?,?)", d)
        D = lambda k: {"key": k, "kind": "meu" if k.startswith("deck:") else "meta", "name": k, "owner": "eu"}  # noqa: E731
        ratings.record_round(ca, "modern", D("deck:x"), D("meta:m"), ["a", "b", "a"], "torneio")
        ca.commit()
        # o B começa de uma cópia do A (exportar → importar a substituir)
        B = os.path.join(tmp, "b")
        os.makedirs(B)
        sqlite3.connect(db_path(B)).close()
        snapshot(A, os.path.join(tmp, "a.grimorio"), device="a")
        assert import_file(B, os.path.join(tmp, "a.grimorio"), "replace")["replaced"]
        cb = sqlite3.connect(db_path(B))
        assert cb.execute("SELECT COUNT(*) FROM decks").fetchone()[0] == 3 and any(f.startswith("grimorio.db.before-import-") for f in os.listdir(B))
        before = ca.execute("SELECT key, format, round(elo, 6), games, wins, losses, rounds, round_wins FROM ratings ORDER BY key").fetchall()
        rebuild_ratings(ca)  # refazer a partir dos jogos dá o mesmo que o registo jogo a jogo
        assert ca.execute("SELECT key, format, round(elo, 6), games, wins, losses, rounds, round_wins FROM ratings ORDER BY key").fetchall() == before
        t0 = 150.0  # hora da última junção A↔B
        # sem rede: o A muda X e W, o B muda Y e W, cria Z, joga um torneio com apostas e mais ratings
        ca.execute("UPDATE decks SET body=?, updated=200 WHERE id='x'", (json.dumps({"main": {"Forest": 3}}),))
        ca.execute("UPDATE decks SET body=?, updated=210 WHERE id='w'", (json.dumps({"main": {"Swamp": 3}}),))
        cb.execute("UPDATE decks SET body=?, updated=220 WHERE id='y'", (json.dumps({"main": {"Island": 3}}),))
        cb.execute("UPDATE decks SET body=?, updated=230 WHERE id='w'", (json.dumps({"main": {"Swamp": 2}}),))
        cb.execute("INSERT INTO decks VALUES (?,?,?,?,?,?,?)", deck("z", "Z", 240, {"Plains": 4}))
        ca.execute("INSERT INTO tournament_games (tid, ts, game) VALUES ('tA', 1, x'00')")  # ocupa o id 1 no A
        cb.execute("INSERT INTO tournament_games (tid, ts, game) VALUES ('t1', 2, x'01')")  # o id 1 do B tem de mudar no A
        cb.execute("INSERT INTO tournaments VALUES ('t1','eu',2,'T','elim','modern','running',NULL,4,?)", (json.dumps({"matches": [{"g": [{"id": 1}]}]}),))
        cb.execute("INSERT INTO bets (owner, tid, kind, mid, pick, stake, odds, ts, status) VALUES ('eu','t1','champ',NULL,0,50,2.0,3,'open')")
        ca.execute("INSERT INTO wallets VALUES ('eu', 900, '2026-01-01')")
        cb.execute("INSERT INTO wallets VALUES ('eu', 950, '2026-01-02')")
        ratings.record_round(cb, "modern", D("deck:y"), D("meta:m"), ["b"], "arena")
        ca.commit()
        cb.commit()
        snapshot(B, os.path.join(tmp, "b.grimorio"), device="b")
        st = import_file(A, os.path.join(tmp, "b.grimorio"), since=t0, keep=False)
        ca = sqlite3.connect(db_path(A))
        bodies = {i: json.loads(b)["main"] for i, b in ca.execute("SELECT id, body FROM decks")}
        assert bodies["x"] == {"Forest": 3} and bodies["y"] == {"Island": 3} and bodies["z"] == {"Plains": 4}, bodies  # as duas mudanças
        assert bodies["w"] == {"Swamp": 2} and st["conflicts"] == ["W (conflito)"]  # W mudou nos dois: ganha o B, o do A fica como cópia
        assert sorted(bodies.values(), key=str).count({"Swamp": 3}) == 1
        t = ca.execute("SELECT status, state FROM tournaments WHERE id='t1'").fetchone()
        gid = ca.execute("SELECT id FROM tournament_games WHERE tid='t1'").fetchone()[0]
        assert t[0] == "paused" and json.loads(t[1])["matches"][0]["g"][0]["id"] == gid != 1  # id do jogo remapeado no estado
        assert ca.execute("SELECT COUNT(*) FROM bets WHERE tid='t1'").fetchone()[0] == 1 and ca.execute("SELECT coins FROM wallets").fetchone()[0] == 950
        assert ca.execute("SELECT games FROM ratings WHERE key='meta:m' AND format='modern'").fetchone()[0] == 4  # 3 do A + 1 do B
        # juntar outra vez não muda nada; e o B a juntar o A fica igual (a cópia do conflito tem o mesmo id)
        snap = lambda c: sorted(c.execute("SELECT id, body, deleted FROM decks").fetchall())  # noqa: E731
        s1 = snap(ca)
        assert import_file(A, os.path.join(tmp, "b.grimorio"), since=t0, keep=False)["conflicts"] == [] and snap(ca) == s1
        snapshot(A, os.path.join(tmp, "a2.grimorio"), device="a")
        import_file(B, os.path.join(tmp, "a2.grimorio"), since=t0, keep=False)
        cb = sqlite3.connect(db_path(B))
        assert snap(cb) == s1, (snap(cb), s1)
        assert cb.execute("SELECT games FROM ratings WHERE key='meta:m' AND format='modern'").fetchone()[0] == 4
        # lixo: apagar no B depois de o A mexer ganha (é a alteração mais recente) e não cria cópia
        cb.execute("UPDATE decks SET deleted=300 WHERE id='z'")
        cb.commit()
        snapshot(B, os.path.join(tmp, "b2.grimorio"), device="b")
        assert import_file(A, os.path.join(tmp, "b2.grimorio"), since=250, keep=False)["conflicts"] == []
        assert sqlite3.connect(db_path(A)).execute("SELECT deleted FROM decks WHERE id='z'").fetchone()[0] == 300
        # ficheiro estragado: erro claro, nada muda
        with open(os.path.join(tmp, "bad.grimorio"), "wb") as f:
            f.write(b"isto nao e um zip")
        try:
            import_file(A, os.path.join(tmp, "bad.grimorio"))
            raise AssertionError("aceitou um ficheiro estragado")
        except ValueError:
            pass
        # ---- versões: uma cópia que pede um nível acima do nosso é recusada com a versão a instalar; uma antiga migra ----
        def man_edit(src, dst, **kv):
            with zipfile.ZipFile(src) as zi, zipfile.ZipFile(dst, "w") as zo:
                for n in zi.namelist():
                    zo.writestr(n, json.dumps({**json.loads(zi.read(n)), **kv}) if n == "manifest.json" else zi.read(n))
        man_edit(os.path.join(tmp, "b2.grimorio"), os.path.join(tmp, "new.grimorio"), needs=LEVEL + 1, version="9.9.0")
        s0 = snap(sqlite3.connect(db_path(A)))
        try:
            import_file(A, os.path.join(tmp, "new.grimorio"), keep=False)
            raise AssertionError("juntou uma cópia de uma versão incompatível")
        except TooNew as e:
            assert e.version == "9.9.0" and "9.9.0" in str(e)
        assert snap(sqlite3.connect(db_path(A))) == s0  # nada mudou
        man_edit(os.path.join(tmp, "b2.grimorio"), os.path.join(tmp, "newok.grimorio"), level=LEVEL + 5, version="9.9.0")  # mais nova mas compatível
        import_file(A, os.path.join(tmp, "newok.grimorio"), since=250, keep=False)
        O = os.path.join(tmp, "old")  # uma cópia de uma versão muito antiga (decks sem dono nem lixo, sem marcas)
        os.makedirs(O)
        co = sqlite3.connect(db_path(O))
        co.execute("CREATE TABLE decks (id TEXT PRIMARY KEY, name TEXT, format TEXT, body TEXT NOT NULL, updated REAL NOT NULL)")
        co.execute("INSERT INTO decks VALUES ('velho', 'Velho', 'modern', ?, 50)", (json.dumps({"main": {"Plains": 60}}),))
        co.commit()
        co.close()
        with zipfile.ZipFile(os.path.join(tmp, "old.grimorio"), "w") as z:
            z.writestr("manifest.json", json.dumps({"app": "grimorio", "format": 1, "created": 60}))
            z.write(db_path(O), "grimorio.db")
        assert import_file(A, os.path.join(tmp, "old.grimorio"), keep=False)["decks_new"] == 1
        ca = sqlite3.connect(db_path(A))
        assert ca.execute("SELECT owner, deleted FROM decks WHERE id='velho'").fetchone() == ("local", None)
        # ---- apagados: a marca viaja, apaga do outro lado e um aparelho antigo não ressuscita nada ----
        cb = sqlite3.connect(db_path(B))
        cb.execute("INSERT INTO sim_runs VALUES ('run1', 'x', 'eu', 120, 'teste', '', '{}')")
        cb.commit()
        snapshot(B, os.path.join(tmp, "b3.grimorio"), device="b")
        import_file(A, os.path.join(tmp, "b3.grimorio"), since=250, keep=False)
        ca = sqlite3.connect(db_path(A))
        assert ca.execute("SELECT 1 FROM sim_runs WHERE id='run1'").fetchone()
        tomb(ca, "sim_run", "run1", "eu", data=row_of(ca, "sim_runs", "run1"))  # o A apaga a sessão de vez
        ca.execute("DELETE FROM sim_runs WHERE id='run1'")
        tomb(ca, "deck", "y", "eu", ts=400)  # e o lixo esvaziou-se do deck Y (apagado às 400)
        ca.execute("DELETE FROM decks WHERE id='y'")
        ca.commit()
        import_file(A, os.path.join(tmp, "b3.grimorio"), since=250, keep=False)  # o B (antigo) ainda tem os dois
        ca = sqlite3.connect(db_path(A))
        assert not ca.execute("SELECT 1 FROM sim_runs WHERE id='run1'").fetchone() and not ca.execute("SELECT 1 FROM decks WHERE id='y'").fetchone()
        snapshot(A, os.path.join(tmp, "a3.grimorio"), device="a")
        st = import_file(B, os.path.join(tmp, "a3.grimorio"), since=250, keep=False)
        cb = sqlite3.connect(db_path(B))
        assert st["deleted"] == 2 and not cb.execute("SELECT 1 FROM sim_runs WHERE id='run1'").fetchone() and not cb.execute("SELECT 1 FROM decks WHERE id='y'").fetchone()
        assert [d["kind"] for d in deleted(ca, "eu")] == ["sim_run"] and deleted(cb, "eu") == []  # o que se repõe fica só onde se apagou
        restore(ca, "eu", "sim_run", "run1")  # repor: volta aqui e, pela marca «reposta», também no B
        ca.commit()
        snapshot(A, os.path.join(tmp, "a4.grimorio"), device="a")
        import_file(B, os.path.join(tmp, "a4.grimorio"), since=250, keep=False)
        assert sqlite3.connect(db_path(B)).execute("SELECT 1 FROM sim_runs WHERE id='run1'").fetchone()
        # ---- conflitos: a lista e as três escolhas ----
        ca = sqlite3.connect(db_path(A))
        cf = conflicts(ca, "eu")
        assert [c["other"]["name"] for c in cf] == ["W (conflito)"] and cf[0]["orig"] == "w" and ["Swamp", 1] in cf[0]["diff"], cf
        resolve(ca, "eu", cf[0]["id"], "other")  # fica a versão do conflito (Swamp 3) no deck original
        assert json.loads(ca.execute("SELECT body FROM decks WHERE id='w'").fetchone()[0])["main"] == {"Swamp": 3} and conflicts(ca, "eu") == []
        for k, nm in (("x", "X"), ("z", "Z")):
            ca.execute("UPDATE decks SET deleted=NULL WHERE id=?", (k,))
            _copy(ca, (k, nm, "modern", json.dumps({"main": {"Mountain": 1}}), 999, "eu"))
        cx, cz = (next(c["id"] for c in conflicts(ca, "eu") if c["orig"] == k) for k in ("x", "z"))
        resolve(ca, "eu", cx, "mine")
        resolve(ca, "eu", cz, "both")
        assert ca.execute("SELECT deleted IS NOT NULL FROM decks WHERE id=?", (cx,)).fetchone() == (1,)
        assert ca.execute("SELECT name FROM decks WHERE id=?", (cz,)).fetchone() == ("Z (2)",) and conflicts(ca, "eu") == []
        try:
            resolve(ca, "outro", cz, "mine")
            raise AssertionError("resolveu o conflito de outro dono")
        except ValueError:
            pass
        ca.commit()
        # ---- donos: juntar com dono nunca toca nas linhas de outro dono (mesmo com o mesmo id) ----
        E = os.path.join(tmp, "e")
        os.makedirs(E)
        ce = sqlite3.connect(db_path(E))
        for s in DDL:
            ce.execute(s)
        ce.execute("INSERT INTO decks VALUES ('x', 'Roubado', 'modern', ?, 9999, 'eva', NULL)", (json.dumps({"main": {"Swamp": 60}}),))
        ce.execute("INSERT INTO decks VALUES ('eva1', 'Da Eva', 'modern', ?, 9999, 'eva', NULL)", (json.dumps({"main": {"Swamp": 60}}),))
        ce.execute("INSERT INTO decks VALUES ('eu9', 'Meu', 'modern', ?, 9999, 'eu', NULL)", (json.dumps({"main": {"Swamp": 60}}),))
        ce.commit()
        ce.close()
        snapshot(E, os.path.join(tmp, "e.grimorio"), device="e")
        bx = ca.execute("SELECT name, body, owner FROM decks WHERE id='x'").fetchone()
        st = import_file(A, os.path.join(tmp, "e.grimorio"), owner="eu", keep=False)
        ca = sqlite3.connect(db_path(A))
        assert ca.execute("SELECT name, body, owner FROM decks WHERE id='x'").fetchone() == bx and st["decks_new"] == 1
        assert not ca.execute("SELECT 1 FROM decks WHERE id='eva1'").fetchone() and ca.execute("SELECT owner FROM decks WHERE id='eu9'").fetchone() == ("eu",)
        # o mesmo com troca de dono (servidor ↔ aparelho): o «eva» da cópia passa a «eu» aqui; o resto não entra
        snapshot(E, os.path.join(tmp, "e2.grimorio"), owner="eva", device="e")
        st = import_file(A, os.path.join(tmp, "e2.grimorio"), owner="eu", keep=False, as_owner="eu")
        ca = sqlite3.connect(db_path(A))
        assert ca.execute("SELECT owner FROM decks WHERE id='eva1'").fetchone() == ("eu",) and not ca.execute("SELECT 1 FROM decks WHERE owner='eva'").fetchone()
        # ---- o que é desta instalação não viaja (convites, salas, Taverna, decks de amigos) e não fica no ficheiro ----
        ca.execute("CREATE TABLE IF NOT EXISTS friends (id TEXT PRIMARY KEY, owner TEXT, name TEXT, token TEXT UNIQUE, created REAL, revoked REAL)")
        ca.execute("INSERT INTO friends VALUES ('f1', 'eu', 'Rui', 'SEGREDO-DO-CONVITE-123', 1, NULL)")
        ca.execute("CREATE TABLE IF NOT EXISTS taverna (owner TEXT PRIMARY KEY, name TEXT)")
        ca.execute("INSERT INTO taverna VALUES ('eu', 'Taverna')")
        ca.execute("INSERT INTO decks VALUES ('amigo1', 'Do Rui', 'modern', ?, 10, 'eu', NULL)", (json.dumps({"main": {}, "friend": "f1"}),))
        ca.commit()
        snapshot(A, os.path.join(tmp, "scrub.grimorio"), device="a", scrub=True)
        with zipfile.ZipFile(os.path.join(tmp, "scrub.grimorio")) as z:
            raw = z.read("grimorio.db")
        assert b"SEGREDO-DO-CONVITE" not in raw and b"Do Rui" not in raw, "dados desta instalação na cópia para sincronizar"
        man, tdb, z = open_zip(os.path.join(tmp, "scrub.grimorio"), A)
        z.close()
        t = sqlite3.connect(tdb)
        assert not _has(t, "main", "friends") and not _has(t, "main", "taverna") and t.execute("SELECT COUNT(*) FROM decks").fetchone()[0] > 0
        t.close()
        os.remove(tdb)
        snapshot(A, os.path.join(tmp, "full.grimorio"), device="a")  # e mesmo sem scrub, a junção nunca traz um deck de amigo
        assert not import_file(B, os.path.join(tmp, "full.grimorio"), since=250, keep=False)["decks_new"] or \
            not sqlite3.connect(db_path(B)).execute("SELECT 1 FROM decks WHERE id='amigo1'").fetchone()
        # ---- delta: os torneios que o outro lado já tem iguais ou mais avançados não vão ----
        assert progress(ca)["t1"][1] == 1
        snapshot(A, os.path.join(tmp, "skip.grimorio"), device="a", skip={"t1": [0, 5]})
        man, tdb, z = open_zip(os.path.join(tmp, "skip.grimorio"), A)
        z.close()
        t = sqlite3.connect(tdb)
        assert not t.execute("SELECT 1 FROM tournaments WHERE id='t1'").fetchone() and man["have"]["t1"] == [0, 1] and man["level"] == LEVEL
        t.close()
        os.remove(tdb)
        # ---- cópias antes de juntar: rodam (ficam as últimas N) ----
        for _ in range(KEEP_BACKUPS["import"] + 2):
            safety_copy(A, "import")
        assert len([f for f in os.listdir(A) if f.startswith("grimorio.db.before-import-")]) == KEEP_BACKUPS["import"]
        assert safety_copy(A, "sync", min_age=3600) and safety_copy(A, "sync", min_age=3600) is None  # no máximo uma por hora
        print("selfcheck sincronização ok")
    finally:
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)
