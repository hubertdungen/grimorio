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
"""
import atexit, json, os, re, socket, sqlite3, sys, tempfile, threading, time, uuid, zipfile

import ratings

FORMAT = 1
COVER = re.compile(r"^[a-z0-9-]{8,40}\.(?:jpg|png|webp|gif)$")
TICK = 60  # segundos entre verificações da pasta
LOCK = threading.RLock()
DATA = None


def db_path(data_dir):
    return os.path.join(data_dir, "grimorio.db")


# ---------- fotografia (zip) ----------

def _filter_owner(con, owner):
    """Deixa só os dados de `owner` numa cópia da base (exportação no modo login)."""
    mine = [r[0] for r in con.execute("SELECT id FROM decks WHERE owner=?", (owner,))]
    keys = [f"deck:{i}" for i in mine]
    q = ",".join("?" * len(keys)) or "''"
    for sql, a in (("DELETE FROM decks WHERE owner IS NOT ?", (owner,)), ("DELETE FROM sim_runs WHERE owner IS NOT ?", (owner,)),
                   (f"DELETE FROM sim_games WHERE deck_id NOT IN ({','.join('?' * len(mine)) or chr(39) * 2})", mine),
                   ("DELETE FROM tournaments WHERE owner IS NOT ?", (owner,)),
                   ("DELETE FROM tournament_games WHERE tid NOT IN (SELECT id FROM tournaments)", ()),
                   ("DELETE FROM bets WHERE owner IS NOT ?", (owner,)), ("DELETE FROM wallets WHERE owner IS NOT ?", (owner,)),
                   ("DELETE FROM profiles", ()), ("DELETE FROM ratings_kv", ()),
                   (f"DELETE FROM rating_games WHERE a_key NOT IN ({q}) AND b_key NOT IN ({q})", keys * 2),
                   (f"DELETE FROM ratings WHERE key NOT IN ({q})", keys)):
        try:
            con.execute(sql, a)
        except sqlite3.OperationalError:  # tabela que esta instalação ainda não tem
            pass
    return set(mine)


def snapshot(data_dir, dest, owner=None, device=""):
    """Escreve o .grimorio em `dest` (atómico). owner = só os dados dele (modo login). Devolve o manifest."""
    fd, tmpdb = tempfile.mkstemp(prefix="snap-", suffix=".db", dir=data_dir)
    os.close(fd)
    try:
        src, dst = sqlite3.connect(db_path(data_dir), timeout=30), sqlite3.connect(tmpdb)
        with LOCK:
            src.backup(dst)
        src.close()
        mine = _filter_owner(dst, owner) if owner else None
        dst.commit()
        counts = {t: dst.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in ("decks", "tournaments", "rating_games")
                  if dst.execute("SELECT 1 FROM sqlite_master WHERE name=?", (t,)).fetchone()}
        dst.close()
        man = {"app": "grimorio", "format": FORMAT, "created": time.time(), "device": device, "scope": "owner" if owner else "all",
               "counts": counts}
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


def open_zip(path, data_dir):
    """Valida um .grimorio e extrai a base para um temporário -> (manifest, caminho da base, zip aberto)."""
    if not zipfile.is_zipfile(path):
        raise ValueError("Este ficheiro não é uma cópia do Grimório.")
    z = zipfile.ZipFile(path)
    try:
        man = json.loads(z.read("manifest.json"))
        if man.get("app") != "grimorio" or int(man.get("format", 0)) > FORMAT:
            raise ValueError("Esta cópia é de uma versão mais nova do Grimório: atualiza primeiro.")
        fd, tmpdb = tempfile.mkstemp(prefix="imp-", suffix=".db", dir=data_dir)
        with os.fdopen(fd, "wb") as f:
            f.write(z.read("grimorio.db"))
        c = sqlite3.connect(tmpdb)
        ok = c.execute("PRAGMA quick_check").fetchone()[0] == "ok" and c.execute("SELECT 1 FROM sqlite_master WHERE name='decks'").fetchone()
        c.close()
        if not ok:
            os.remove(tmpdb)
            raise ValueError("A base de dados dentro da cópia está estragada.")
        return man, tmpdb, z
    except (KeyError, json.JSONDecodeError, zipfile.BadZipFile, sqlite3.DatabaseError):
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


def import_file(data_dir, path, mode="merge", owner=None, since=None, keep=True):
    """Junta (merge) ou substitui (replace) a base com a cópia em `path`. keep = guardar a base atual antes.
    since = hora da última junção com quem fez a cópia (sync); por omissão a da própria cópia (sem conflitos:
    ganha o mais recente). Devolve as contagens."""
    if mode == "replace" and owner:
        raise ValueError("Com login só dá para juntar (substituir apagava os dados dos outros).")
    man, tmpdb, z = open_zip(path, data_dir)
    try:
        with LOCK:
            live = sqlite3.connect(db_path(data_dir), timeout=30)
            if keep:
                b = sqlite3.connect(db_path(data_dir) + f".before-import-{time.strftime('%Y%m%d-%H%M%S')}")
                live.backup(b)
                b.close()
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
        return {**st, "from": {k: man.get(k) for k in ("created", "device", "counts")}}
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


def merge(con, src_path, since=0.0, owner=None):
    """Junta a base em src_path na base de `con` (regras no topo do ficheiro). owner = só linhas desse dono."""
    st = {"decks_new": 0, "decks_updated": 0, "conflicts": [], "tournaments": 0, "games": 0, "rating_games": 0}
    con.execute("ATTACH DATABASE ? AS r", (src_path,))
    try:
        mine = (lambda o: owner is None or o == owner)
        # decks
        for row in con.execute("SELECT id, name, format, body, updated, owner, deleted FROM r.decks").fetchall():
            if not mine(row[5]):
                continue
            loc = con.execute("SELECT id, name, format, body, updated, owner, deleted FROM main.decks WHERE id=?", (row[0],)).fetchone()
            if not loc:
                con.execute("INSERT INTO main.decks (id, name, format, body, updated, owner, deleted) VALUES (?,?,?,?,?,?,?)", row)
                st["decks_new"] += 1
                continue
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
            con.execute("INSERT OR IGNORE INTO main.profiles SELECT * FROM r.profiles")
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
            tc = _cols(con, "main", "tournaments")
            for row in con.execute(f"SELECT {','.join(tc)} FROM r.tournaments").fetchall():
                t = dict(zip(tc, row))
                if not mine(t["owner"]):
                    continue
                loc = con.execute("SELECT status FROM main.tournaments WHERE id=?", (t["id"],)).fetchone()
                if loc and prog("main", t["id"], loc[0]) >= prog("r", t["id"], t["status"]):
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
                con.execute(f"INSERT OR REPLACE INTO main.tournaments ({','.join(tc)}) VALUES ({','.join('?' * len(tc))})", [t[c] for c in tc])
                if _has(con, "r", "bets") and _has(con, "main", "bets"):
                    con.execute("DELETE FROM main.bets WHERE tid=?", (t["id"],))
                    _union(con, "bets", BET_KEY, "tid=?", (t["id"],))
                st["tournaments"] += 1
            if _has(con, "r", "bets") and _has(con, "main", "bets"):  # apostas de torneios que não mudaram de versão
                _union(con, "bets", BET_KEY, "? IS NULL OR owner=?", (owner, owner))
        if _has(con, "r", "wallets") and _has(con, "main", "wallets"):
            for own, coins, sub in con.execute("SELECT owner, coins, subsidy FROM r.wallets").fetchall():
                if mine(own):
                    con.execute("INSERT INTO main.wallets VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET coins=max(coins, excluded.coins),"
                                " subsidy=max(coalesce(subsidy, ''), coalesce(excluded.subsidy, ''))", (own, coins, sub))
        # ratings: jogos pelo conteúdo, linhas que faltam (nomes) e depois refazer tudo
        if _has(con, "r", "rating_games") and _has(con, "main", "rating_games"):
            st["rating_games"] = _union(con, "rating_games", ("round_id", "ts", "a_key", "b_key", "winner"))
            n = 0
            if _has(con, "r", "ratings"):
                n = con.execute("INSERT OR IGNORE INTO main.ratings SELECT * FROM r.ratings").rowcount
            if _has(con, "r", "ratings_kv"):
                for k, v in con.execute("SELECT k, v FROM r.ratings_kv WHERE k LIKE 'reset:%' OR k='arena_played'").fetchall():
                    old = con.execute("SELECT v FROM main.ratings_kv WHERE k=?", (k,)).fetchone()
                    if not old or json.loads(v) > json.loads(old[0]):
                        con.execute("INSERT OR REPLACE INTO main.ratings_kv VALUES (?,?)", (k, v))
                        n += 1
            if st["rating_games"] or n:
                rebuild_ratings(con)
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


def fingerprint(data_dir):
    """Muda quando algo que vale a pena levar muda (decks, torneios, jogos, apostas, testes, perfis)."""
    con = sqlite3.connect(db_path(data_dir), timeout=30)
    out = []
    for q in ("SELECT COUNT(*), max(updated), max(deleted) FROM decks", "SELECT COUNT(*), group_concat(status) FROM tournaments",
              "SELECT max(id) FROM tournament_games", "SELECT COUNT(*), max(id) FROM rating_games", "SELECT COUNT(*), sum(stake), group_concat(status) FROM bets",
              "SELECT sum(coins) FROM wallets", "SELECT COUNT(*) FROM sim_runs", "SELECT COUNT(*) FROM sim_games", "SELECT COUNT(*), group_concat(name) FROM profiles"):
        try:
            out.append(con.execute(q).fetchone())
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
        c["error"] = None
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
                # cópia de segurança única antes de cada junção (a última fica em grimorio.db.before-sync)
                live, b = sqlite3.connect(db_path(data_dir), timeout=30), sqlite3.connect(db_path(data_dir) + ".before-sync")
                live.backup(b)
                b.close()
                live.close()
                st = import_file(data_dir, p, "merge", since=c["since"].get(dev, 0), keep=False)
            except ValueError as e:  # a app de sync ainda está a descarregar: tenta na próxima volta
                c["error"] = f"{f}: {e}"
                continue
            c["seen"][f], c["since"][dev] = mt, time.time()
            c["last_pull"] = {"at": time.time(), "device": dev, **{k: st[k] for k in ("decks_new", "decks_updated", "tournaments", "rating_games")}}
            c["conflicts"] = (c["conflicts"] + [{"at": time.time(), "device": dev, "deck": n} for n in st["conflicts"]])[-20:]
        fp = fingerprint(data_dir)
        if force or fp != c.get("fp") or not os.path.exists(os.path.join(folder, mine)):
            try:
                snapshot(data_dir, os.path.join(folder, mine), device=c["device"])
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
    return {**{k: c.get(k) for k in ("on", "folder", "device", "last_push", "last_pull", "conflicts", "error")},
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
        print("selfcheck sincronização ok")
    finally:
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)
