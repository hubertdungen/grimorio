"""Amigos e convidados: o anfitrião (quem tem o Grimório com o Forge, num NAS ou num PC) convida amigos por link.

Cada amigo tem um token. Abrir /convite/<token> põe o cookie `grimorio_guest` e, a partir daí, esse browser é um
convidado: vê e edita só os seus decks (guardados no anfitrião com `friend` = o id do amigo), vê os torneios em que
entra ou que estão abertos a amigos, aposta com a sua carteira (`guest:<id>`) e lê os dados públicos (cartas, meta).
Tudo o resto responde 403: um convidado nunca chega às rotas do dono.

Endereços de convidados (GRIMORIO_GUEST_HOSTS, ex. o domínio público sem 2FA): sem convite válido só servem a app e
as cartas — as APIs pedem convite.
"""
import hashlib, html, json, os, re, secrets, socket, sqlite3, time, urllib.parse, uuid

COOKIE = "grimorio_guest"
# versão da API das salas para outro Grimório (a app de um amigo fala com estas rotas com «Authorization: Bearer <convite>»):
# sobe quando as rotas de BEARER mudarem de forma incompatível; a app do amigo compara e, se não bater, abre a página daqui
API = 2  # 2: a mesa estrita (playnet pelo convite)
BEARER = re.compile(r"^/api/(guest/me|guest/decks|rooms(/[a-z0-9]{1,16}(/[a-z]{1,12})?)?|freetables/[a-z0-9]{1,16}(/[a-z]{1,12})?|playnet/[a-f0-9]{12}(/cmd|/stop)?"
                    r"|taverna(/[a-z]{2,10}(/[a-f0-9]{12})?)?)$")  # playnet: a mesa estrita; taverna: a Taverna de quem aloja (taverna.py)
VOLTA = re.compile(r"https?://[A-Za-z0-9.:\[\]-]{1,120}/?")  # «← O meu Grimório»: só a origem do Grimório de quem vem
DECK = re.compile(r"^/api/decks/([a-z0-9-]{8,40})$")
TOUR = re.compile(r"^/api/tournaments/([a-z0-9]{12})(/.*)?$")
# GET que um convidado pode ler como está (dados públicos, sem nada do dono)
PASS_GET = ("/data/", "/arts/", "/covers/", "/assets/", "/ocr/", "/api/health", "/api/import", "/api/search/decks",
            "/api/sim/difficulties", "/api/sim/opponents", "/api/meta/", "/api/l17/", "/api/edhrec/", "/api/ratings", "/api/rules")


def init(con):
    con.execute("CREATE TABLE IF NOT EXISTS friends (id TEXT PRIMARY KEY, owner TEXT, name TEXT, token TEXT UNIQUE,"
                " created REAL, revoked REAL)")
    try:  # ext: hash da chave de um perfil ligado (deste Grimório, de outro, de uma cópia) — o mesmo perfil não se duplica
        con.execute("ALTER TABLE friends ADD COLUMN ext TEXT")
    except sqlite3.OperationalError:
        pass


def by_token(con, token):
    init(con)
    r = con.execute("SELECT id, owner, name FROM friends WHERE token=? AND revoked IS NULL", (str(token)[:80],)).fetchone() if token else None
    return r and {"id": r[0], "owner": r[1], "name": r[2]}


def bearer(headers):
    """«Authorization: Bearer <token do convite>»: a app de um amigo a falar com as salas daqui (sem cookies)."""
    a = headers.get("Authorization") or ""
    return a[7:].strip() if a[:7].lower() == "bearer " else ""


def cookie_token(headers):
    for part in (headers.get("Cookie") or "").split(";"):
        k, _, v = part.strip().partition("=")
        if k == COOKIE:
            return v
    return ""


def lan_ip():
    """O IP desta máquina na rede de casa (para o link e o QR no telemóvel)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.168.0.1", 9))  # não envia nada: só escolhe a interface de saída
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def guest_hosts():
    """Os endereços de convidados: GRIMORIO_GUEST_HOSTS e o endereço público próprio (Definições › Amigos)."""
    import share
    own = share.custom_host()
    return {h.strip().lower() for h in os.environ.get("GRIMORIO_GUEST_HOSTS", "").split(",") if h.strip()} | ({own} if own else set())


def host_id(con):
    """Identidade estável deste Grimório (não o endereço, que no túnel rápido muda a cada arranque): a app de um amigo
    reconhece o mesmo anfitrião e atualiza a sala guardada em vez de criar outra."""
    con.execute("CREATE TABLE IF NOT EXISTS host_meta (k TEXT PRIMARY KEY, v TEXT)")
    r = con.execute("SELECT v FROM host_meta WHERE k='hid'").fetchone()
    if r:
        return r[0]
    v = secrets.token_hex(8)
    con.execute("INSERT OR IGNORE INTO host_meta VALUES ('hid', ?)", (v,))
    return con.execute("SELECT v FROM host_meta WHERE k='hid'").fetchone()[0]


def is_guest_host(headers):
    """Os dois cabeçalhos contam: pelo túnel (cloudflared -> 127.0.0.1) o X-Forwarded-Host vem de quem pede e não se pode
    confiar nele sozinho (um «X-Forwarded-Host: 127.0.0.1» passava por dono); atrás do Caddy chega igual ao Host."""
    for v in (headers.get("X-Forwarded-Host"), headers.get("Host")):
        host = (v or "").split(",")[0].strip().split(":")[0].lower()
        if host and (host in guest_hosts() or host.endswith(".trycloudflare.com")):
            return True
    return False


def public_ok(method, path):
    """Num endereço de convidados, sem convite: só a app (página e ficheiros) e as cartas."""
    return method in ("GET", "HEAD") and not path.startswith(("/api/", "/play"))


# ---------- dono: gerir os amigos ----------

def owner_route(con, method, path, owner, body, port, tunnel=None, host="0.0.0.0"):
    """GET /api/friends -> {friends, lan, public}; POST {name}; POST /<id>/revoke; DELETE /<id> (os decks dele ficam)."""
    init(con)
    m = re.match(r"^/api/friends(?:/([a-f0-9]{12})(/revoke)?)?$", path)
    if not m:
        return 404, {"erro": "rota desconhecida"}
    fid = m.group(1)
    if method == "GET" and not fid:
        rows = con.execute("SELECT id, name, token, created, revoked FROM friends WHERE owner=? ORDER BY created", (owner,)).fetchall()
        decks = {}
        for (f,) in con.execute("SELECT json_extract(body, '$.friend') FROM decks WHERE owner=? AND deleted IS NULL AND json_extract(body, '$.friend') IS NOT NULL", (owner,)):
            decks[f] = decks.get(f, 0) + 1
        import share
        pub = os.environ.get("GRIMORIO_PUBLIC_URL", "").rstrip("/") or share.custom_url() or tunnel  # endereço próprio ou o túnel da partilha
        return 200, {"friends": [{"id": i, "name": n, "token": t, "created": c, "revoked": r, "decks": decks.get(i, 0)} for i, n, t, c, r in rows],
                     # só este computador (127.0.0.1, os pacotes por omissão): o link de casa não chegava a ninguém
                     "lan": None if host in ("127.0.0.1", "localhost", "::1") else f"http://{lan_ip()}:{port}", "public": pub or None}
    if method == "POST" and not fid:
        name = str((body or {}).get("name") or "").strip()[:40]
        if not name:
            return 400, {"erro": "Falta o nome do amigo."}
        fid = secrets.token_hex(6)
        con.execute("INSERT INTO friends (id, owner, name, token, created, revoked) VALUES (?,?,?,?,?,NULL)", (fid, owner, name, secrets.token_urlsafe(18), time.time()))
        return 201, {"id": fid}
    if method == "POST" and m.group(2):  # revogar: o link deixa de entrar (pode criar-se outro)
        n = con.execute("UPDATE friends SET revoked=? WHERE id=? AND owner=?", (time.time(), fid, owner)).rowcount
        return (200, {"ok": True}) if n else (404, {"erro": "não existe"})
    if method == "DELETE" and fid:
        n = con.execute("DELETE FROM friends WHERE id=? AND owner=?", (fid, owner)).rowcount
        return (200, {"ok": True}) if n else (404, {"erro": "não existe"})
    return 404, {"erro": "rota desconhecida"}


# ---------- convidado ----------

def _volta(q):
    """?volta=<origem do Grimório de quem vem> passa para a app (o «← O meu Grimório» do convidado)."""
    v = (q.get("volta") or [""])[0]
    return f"?volta={urllib.parse.quote(v, safe='')}#online" if VOLTA.fullmatch(v) else ""  # vem de outro Grimório: às salas


# ---------- as páginas dos links (convite, sala, Taverna) na língua de quem as abre ----------
# ?lang=xx, senão o Accept-Language (pt-BR, pt-PT… -> pt; uma língua que não há -> en); o seletor no topo muda e a app,
# neste browser, fica com a escolha (grimorio.lang, como em i18n.js).
LANGS = {"pt": ("pt-PT", "Português"), "en": ("en", "English"), "es": ("es", "Español"), "de": ("de", "Deutsch"), "zh": ("zh-CN", "简体中文")}
TXT = {
    "pt": {
        "app": "📲 Abrir na app Grimório", "noapp": "A app não abriu? Se não a tens neste aparelho, continua no browser.", "lang": "Língua",
        "inv_bad": "Este convite já não é válido. Pede outro a quem te convidou.", "inv_h": "🤝 Convite para o Grimório",
        "inv_p": "<b>{n}</b>, foste convidado para jogar neste Grimório: salas, mesas livres e torneios com os amigos de quem te convidou.",
        "browser": "Continuar no browser",
        "inv_box": "Na app Grimório (PC ou telemóvel) entras com os teus decks de lá. No browser, os decks ficam guardados neste Grimório; os da tua app"
                   " trazes com «📥 Trazer os meus decks» (o ficheiro de Biblioteca › Exportar decks).",
        "room_bad": "Esta sala já não está aberta. Pede outro link a quem te convidou.",
        "strict": "⚖ <b>Mesa estrita · regras do Forge</b><br>Só amigos, sem bots: o Forge faz cumprir as regras (mana, pilha, combate, alvos) e cada um joga no seu ecrã.",
        "free": "🃏 <b>Mesa livre · sem regras</b><br>Só amigos, sem bots: cada um mexe nas suas cartas, como numa mesa a sério (compras, viras, atacas, contas a vida)."
                " Ninguém valida as jogadas.",
        "bots": "🤖 <b>Com os bots do Forge</b><br>Juntas um deck teu e os bots do Forge jogam-no por ti, com as regras todas; tu vês ao vivo e podes apostar.",
        "as_prof": "👤 Entrar como {n}", "as_prof_s": "com os teus decks deste Grimório", "other": "ou, com outro nome:",
        "room_p": "Entra com um nome para jogares nesta sala. Não precisas de ter decks: na sala podes usar um emprestado, um do meta ou colar a tua lista.",
        "name_ph": "O teu nome", "enter": "Entrar", "has_app": "Tens o Grimório no teu PC ou telemóvel?",
        "room_app": "Na tua app: Coliseu › 🌍 Online › «🔗 Entrar com um link» e cola este link: entras como o teu perfil, com os teus decks.",
        "copy": "Ou traz uma cópia do teu Grimório (ficheiro <b>.grimorio</b>, em Definições › Cópias):",
        "reading": "A ler…", "failed": "Não deu.", "which": "Que perfil és tu? ", "room": "Sala",
        "tv_bad": "Este link da Taverna já não é válido. Pede outro a quem te convidou.",
        "tv_closed": "Quem aloja fechou esta Taverna: o link já não deixa entrar.",
        "tv_box": "A Taverna é o sítio dos amigos neste Grimório: conversa, decks partilhados, jogos combinados e um Hall da Fama só vosso.",
        "tv_p": "Entra com um nome (é assim que os outros te veem).", "tv_enter": "Entrar na Taverna",
        "tv_app": "Na tua app: Coliseu › 🍺 Taverna › «🔗 Entrar com um link» e cola este link: entras como o teu perfil e os teus decks ficam contigo.",
        "kicked": "Quem aloja tirou-te desta Taverna.", "revoked": "Este convite foi revogado por quem aloja.",
    },
    "en": {
        "app": "📲 Open in the Grimório app", "noapp": "The app didn't open? If you don't have it on this device, continue in the browser.", "lang": "Language",
        "inv_bad": "This invite is no longer valid. Ask whoever invited you for a new one.", "inv_h": "🤝 Invitation to Grimório",
        "inv_p": "<b>{n}</b>, you've been invited to play on this Grimório: rooms, free tables and tournaments with the friends of whoever invited you.",
        "browser": "Continue in the browser",
        "inv_box": "In the Grimório app (PC or phone) you join with your decks from there. In the browser, your decks are kept on this Grimório; bring the"
                   " ones from your app with “📥 Bring my decks” (the file from Library › Export decks).",
        "room_bad": "This room is no longer open. Ask whoever invited you for a new link.",
        "strict": "⚖ <b>Strict table · Forge rules</b><br>Friends only, no bots: Forge enforces the rules (mana, stack, combat, targets) and everyone plays on their own screen.",
        "free": "🃏 <b>Free table · no rules</b><br>Friends only, no bots: everyone handles their own cards, like at a real table (draw, tap, attack, keep track of life)."
                " Nobody checks the plays.",
        "bots": "🤖 <b>With the Forge bots</b><br>You enter a deck of yours and the Forge bots play it for you, with all the rules; you watch live and can place bets.",
        "as_prof": "👤 Join as {n}", "as_prof_s": "with your decks from this Grimório", "other": "or, with another name:",
        "room_p": "Enter a name to play in this room. You don't need any decks: in the room you can borrow one, use one from the meta or paste your list.",
        "name_ph": "Your name", "enter": "Join", "has_app": "Have Grimório on your PC or phone?",
        "room_app": "In your app: Coliseum › 🌍 Online › “🔗 Join with a link” and paste this link: you join as your profile, with your decks.",
        "copy": "Or bring a backup of your Grimório (a <b>.grimorio</b> file, from Settings › Backups):",
        "reading": "Reading…", "failed": "That didn't work.", "which": "Which profile are you? ", "room": "Room",
        "tv_bad": "This Tavern link is no longer valid. Ask whoever invited you for a new one.",
        "tv_closed": "The host has closed this Tavern: the link no longer lets anyone in.",
        "tv_box": "The Tavern is the friends' corner of this Grimório: chat, shared decks, arranged games and a Hall of Fame all your own.",
        "tv_p": "Enter a name (it's how the others will see you).", "tv_enter": "Enter the Tavern",
        "tv_app": "In your app: Coliseum › 🍺 Tavern › “🔗 Join with a link” and paste this link: you join as your profile and your decks stay with you.",
        "kicked": "The host removed you from this Tavern.", "revoked": "This invite was revoked by the host.",
    },
    "es": {
        "app": "📲 Abrir en la app Grimório", "noapp": "¿No se ha abierto la app? Si no la tienes en este dispositivo, sigue en el navegador.", "lang": "Idioma",
        "inv_bad": "Esta invitación ya no es válida. Pide otra a quien te invitó.", "inv_h": "🤝 Invitación al Grimório",
        "inv_p": "<b>{n}</b>, te han invitado a jugar en este Grimório: salas, mesas libres y torneos con los amigos de quien te invitó.",
        "browser": "Seguir en el navegador",
        "inv_box": "En la app Grimório (PC o móvil) entras con tus mazos de allí. En el navegador, los mazos se guardan en este Grimório; los de tu app"
                   " los traes con «📥 Traer mis mazos» (el archivo de Biblioteca › Exportar mazos).",
        "room_bad": "Esta sala ya no está abierta. Pide otro enlace a quien te invitó.",
        "strict": "⚖ <b>Mesa estricta · reglas de Forge</b><br>Solo amigos, sin bots: Forge hace cumplir las reglas (maná, pila, combate, objetivos) y cada uno juega en su pantalla.",
        "free": "🃏 <b>Mesa libre · sin reglas</b><br>Solo amigos, sin bots: cada uno mueve sus cartas, como en una mesa de verdad (robas, giras, atacas, llevas las vidas)."
                " Nadie valida las jugadas.",
        "bots": "🤖 <b>Con los bots de Forge</b><br>Apuntas un mazo tuyo y los bots de Forge lo juegan por ti, con todas las reglas; tú lo ves en directo y puedes apostar.",
        "as_prof": "👤 Entrar como {n}", "as_prof_s": "con tus mazos de este Grimório", "other": "o, con otro nombre:",
        "room_p": "Entra con un nombre para jugar en esta sala. No necesitas tener mazos: en la sala puedes usar uno prestado, uno del meta o pegar tu lista.",
        "name_ph": "Tu nombre", "enter": "Entrar", "has_app": "¿Tienes el Grimório en tu PC o móvil?",
        "room_app": "En tu app: Coliseo › 🌍 En línea › «🔗 Entrar con un enlace» y pega este enlace: entras con tu perfil y tus mazos.",
        "copy": "O trae una copia de tu Grimório (archivo <b>.grimorio</b>, en Ajustes › Copias):",
        "reading": "Leyendo…", "failed": "No ha funcionado.", "which": "¿Qué perfil eres? ", "room": "Sala",
        "tv_bad": "Este enlace de la Taberna ya no es válido. Pide otro a quien te invitó.",
        "tv_closed": "Quien aloja ha cerrado esta Taberna: el enlace ya no deja entrar.",
        "tv_box": "La Taberna es el rincón de los amigos en este Grimório: charla, mazos compartidos, partidas acordadas y un Salón de la Fama solo vuestro.",
        "tv_p": "Entra con un nombre (así te verán los demás).", "tv_enter": "Entrar en la Taberna",
        "tv_app": "En tu app: Coliseo › 🍺 Taberna › «🔗 Entrar con un enlace» y pega este enlace: entras con tu perfil y tus mazos se quedan contigo.",
        "kicked": "Quien aloja te ha sacado de esta Taberna.", "revoked": "Quien aloja ha revocado esta invitación.",
    },
    "de": {
        "app": "📲 In der Grimório-App öffnen", "noapp": "Die App hat sich nicht geöffnet? Wenn du sie auf diesem Gerät nicht hast, mach im Browser weiter.", "lang": "Sprache",
        "inv_bad": "Diese Einladung ist nicht mehr gültig. Bitte die Person, die dich eingeladen hat, um eine neue.", "inv_h": "🤝 Einladung zu Grimório",
        "inv_p": "<b>{n}</b>, du wurdest eingeladen, auf diesem Grimório zu spielen: Räume, freie Tische und Turniere mit den Freunden der Person, die dich eingeladen hat.",
        "browser": "Im Browser weiter",
        "inv_box": "In der Grimório-App (PC oder Handy) trittst du mit deinen Decks von dort bei. Im Browser werden die Decks auf diesem Grimório gespeichert;"
                   " die aus deiner App bringst du mit „📥 Meine Decks mitbringen“ mit (die Datei aus Bibliothek › Decks exportieren).",
        "room_bad": "Dieser Raum ist nicht mehr offen. Bitte die Person, die dich eingeladen hat, um einen neuen Link.",
        "strict": "⚖ <b>Strenger Tisch · Forge-Regeln</b><br>Nur Freunde, keine Bots: Forge setzt die Regeln durch (Mana, Stapel, Kampf, Ziele) und jeder spielt auf seinem eigenen Bildschirm.",
        "free": "🃏 <b>Freier Tisch · ohne Regeln</b><br>Nur Freunde, keine Bots: Jeder bewegt seine eigenen Karten, wie an einem echten Tisch (ziehen, tappen, angreifen,"
                " Lebenspunkte zählen). Niemand prüft die Spielzüge.",
        "bots": "🤖 <b>Mit den Forge-Bots</b><br>Du meldest ein Deck von dir an und die Forge-Bots spielen es für dich, mit allen Regeln; du schaust live zu und kannst wetten.",
        "as_prof": "👤 Als {n} beitreten", "as_prof_s": "mit deinen Decks von diesem Grimório", "other": "oder mit einem anderen Namen:",
        "room_p": "Gib einen Namen ein, um in diesem Raum zu spielen. Du brauchst keine Decks: Im Raum kannst du eines leihen, eines aus dem Meta nehmen oder deine Liste einfügen.",
        "name_ph": "Dein Name", "enter": "Beitreten", "has_app": "Hast du Grimório auf deinem PC oder Handy?",
        "room_app": "In deiner App: Kolosseum › 🌍 Online › „🔗 Mit Link beitreten“ und diesen Link einfügen: Du trittst mit deinem Profil und deinen Decks bei.",
        "copy": "Oder bring eine Sicherung deines Grimório mit (eine <b>.grimorio</b>-Datei, unter Einstellungen › Sicherungen):",
        "reading": "Wird gelesen…", "failed": "Das hat nicht geklappt.", "which": "Welches Profil bist du? ", "room": "Raum",
        "tv_bad": "Dieser Link zur Taverne ist nicht mehr gültig. Bitte die Person, die dich eingeladen hat, um einen neuen.",
        "tv_closed": "Der Gastgeber hat diese Taverne geschlossen: Der Link lässt niemanden mehr hinein.",
        "tv_box": "Die Taverne ist der Treffpunkt der Freunde auf diesem Grimório: Chat, geteilte Decks, verabredete Spiele und eure eigene Ruhmeshalle.",
        "tv_p": "Gib einen Namen ein (so sehen dich die anderen).", "tv_enter": "Taverne betreten",
        "tv_app": "In deiner App: Kolosseum › 🍺 Taverne › „🔗 Mit Link beitreten“ und diesen Link einfügen: Du trittst mit deinem Profil bei und deine Decks bleiben bei dir.",
        "kicked": "Der Gastgeber hat dich aus dieser Taverne entfernt.", "revoked": "Diese Einladung wurde vom Gastgeber widerrufen.",
    },
    "zh": {
        "app": "📲 在 Grimório 应用中打开", "noapp": "应用没有打开？如果这台设备上没有安装，请继续在浏览器中使用。", "lang": "语言",
        "inv_bad": "此邀请已失效。请向邀请你的人再要一个。", "inv_h": "🤝 Grimório 邀请",
        "inv_p": "<b>{n}</b>，你受邀在这个 Grimório 上游戏：和邀请你的人的朋友们一起使用房间、自由牌桌和锦标赛。",
        "browser": "在浏览器中继续",
        "inv_box": "在 Grimório 应用（电脑或手机）中，你会带着那里的套牌加入。在浏览器中，套牌保存在这个 Grimório 上；应用里的套牌可以用“📥 带上我的套牌”带过来（牌库 › 导出套牌 生成的文件）。",
        "room_bad": "这个房间已不再开放。请向邀请你的人再要一个链接。",
        "strict": "⚖ <b>严格牌桌 · Forge 规则</b><br>只有朋友，没有机器人：Forge 执行规则（法术力、堆叠、战斗、目标），每人在自己的屏幕上游戏。",
        "free": "🃏 <b>自由牌桌 · 无规则</b><br>只有朋友，没有机器人：每人操作自己的牌，就像在真正的牌桌上（抓牌、横置、攻击、记录生命）。没有人校验操作。",
        "bots": "🤖 <b>使用 Forge 机器人</b><br>你报名一副自己的套牌，由 Forge 机器人按完整规则替你对战；你可以实时观看并下注。",
        "as_prof": "👤 以 {n} 的身份加入", "as_prof_s": "使用你在这个 Grimório 上的套牌", "other": "或者，用另一个名字：",
        "room_p": "输入一个名字即可在这个房间游戏。你不需要有套牌：在房间里可以借一副、用一副环境套牌，或粘贴你的牌表。",
        "name_ph": "你的名字", "enter": "加入", "has_app": "你的电脑或手机上装了 Grimório 吗？",
        "room_app": "在你的应用中：竞技场 › 🌍 在线 › “🔗 通过链接加入”，粘贴此链接：你将以自己的档案和套牌加入。",
        "copy": "或者带上你的 Grimório 备份（<b>.grimorio</b> 文件，在 设置 › 备份 中）：",
        "reading": "读取中…", "failed": "没有成功。", "which": "你是哪个档案？", "room": "房间",
        "tv_bad": "此酒馆链接已失效。请向邀请你的人再要一个。",
        "tv_closed": "主人已关闭这家酒馆：链接不再允许任何人进入。",
        "tv_box": "酒馆是这个 Grimório 上朋友们的聚集地：聊天、共享套牌、约好的对局，还有只属于你们的名人堂。",
        "tv_p": "输入一个名字（其他人会这样看到你）。", "tv_enter": "进入酒馆",
        "tv_app": "在你的应用中：竞技场 › 🍺 酒馆 › “🔗 通过链接加入”，粘贴此链接：你将以自己的档案加入，套牌也会跟着你。",
        "kicked": "主人已将你移出这家酒馆。", "revoked": "此邀请已被主人撤销。",
    },
}
ERR_KEY = {TXT["pt"][k]: k for k in ("kicked", "revoked", "tv_closed")}  # PermissionError (texto em pt) -> a mesma frase na língua da página
assert all(TXT[x].keys() == TXT["pt"].keys() for x in LANGS), "guests.TXT: todas as línguas com as mesmas chaves"


def pt_left(page, L):
    """(selfcheck) Pedaços dos textos em pt (12+ caracteres) que ficaram numa página em L."""
    out = []
    for k, s in TXT["pt"].items():
        for frag in re.split(r"<[^>]+>|\{\w+\}|[«»“”„()]", s):
            frag = frag.strip(" ,.:;?!·›")
            if len(frag) >= 12 and frag not in TXT[L][k] and frag in page:
                out.append(frag)
    return out


def lang(h):
    """A língua da página: ?lang=xx, senão a primeira do Accept-Language que houver aqui, senão inglês."""
    v = (urllib.parse.parse_qs(urllib.parse.urlsplit(h.path).query).get("lang") or [""])[0].lower()
    if v in LANGS:
        return v
    tags = []
    for i, part in enumerate(str(h.headers.get("Accept-Language") or "")[:300].split(",")[:20]):
        tag, _, prm = part.strip().partition(";")
        try:
            q = float(prm.strip()[2:]) if prm.strip().startswith("q=") else 1.0
        except ValueError:
            q = 0.0
        tags.append((-q, i, tag.strip().lower().split("-")[0]))
    return next((x for q, _, x in sorted(tags) if x in LANGS and q < 0), "en")


def t(L, k, **kw):
    """Um texto das páginas dos links na língua L (os {valores} escapados para HTML)."""
    s = TXT.get(L, TXT["en"]).get(k) or TXT["pt"][k]
    return s.format(**{a: html.escape(str(b)) for a, b in kw.items()}) if kw else s


def app_btn(L):
    """«Abrir na app Grimório»: grimorio://join?u=<este link> (o .exe, o pacote Linux e o APK registam o esquema). Sem a app
    nada acontece; ao fim de 1,5 s com a página ainda à vista diz para continuar no browser.
    ponytail: não se tenta abrir a app sozinho ao carregar — o Firefox mostra uma página de erro para esquemas desconhecidos"""
    return (f"<p><a class=go id=app href='#'>{t(L, 'app')}</a></p><p id=noapp hidden><small>{t(L, 'noapp')}</small></p>"
            "<script>app.href='grimorio://join?u='+encodeURIComponent(location.origin+location.pathname);"
            "app.onclick=()=>setTimeout(()=>{if(!document.hidden)noapp.hidden=false},1500)</script>")


def accept(h, con, token, query=""):
    """GET /convite/<token>: uma página com «Abrir na app Grimório» e «Continuar no browser» (?entrar=1: cookie de
    convidado e vai para a app; quem já tem este convite no browser entra logo). /convite/<token>/info -> JSON para a app
    de um amigo. Convite inválido -> página a explicar."""
    token, _, act = token.partition("/")
    g = by_token(con, token)
    if act == "info":
        return h.json({"api": API, "kind": "convite", "name": g["name"], "hid": host_id(con)}) if g else h.json({"erro": "Este convite já não é válido."}, 404)
    L = lang(h)
    if not g or act:
        return _page(h, f"<p>{t(L, 'inv_bad')}</p>", 404, L)
    q = urllib.parse.parse_qs(query)
    if "entrar" in q or cookie_token(h.headers) == token:
        return h.send(302, b"", "text/plain", {"Location": "/" + _volta(q), "Set-Cookie": f"{COOKIE}={token}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly"})
    return _page(h, f"<h2>{t(L, 'inv_h')}</h2><p>{t(L, 'inv_p', n=g['name'])}</p>" + app_btn(L) +
                 f"<p><a class=alt href='?entrar=1'>{t(L, 'browser')}</a></p><div class=box><small>{t(L, 'inv_box')}</small></div>", 200, L)


def invite_post(h, con, token, act):
    """POST /convite/<token>/trazer {name?, key?, decks}: a app de um amigo (o servidor dela) traz decks para o perfil deste
    convite. Autentica-se pelo token do link; com a chave da app (a mesma de cada vez) os decks atualizam-se e o convite
    fica ligado a essa app (os links de salas dela passam a reconhecê-lo)."""
    g = by_token(con, token)
    if act != "trazer" or not g:
        return h.json({"erro": "Este convite já não é válido."}, 404)
    if slow(("convite", token)):
        return h.json({"erro": "Demasiados pedidos: espera um minuto."}, 429)
    try:
        d = h.body()
    except ValueError as e:
        return h.json({"erro": str(e)}, 400)
    key = str((d or {}).get("key") or "") if isinstance(d, dict) else ""
    if not isinstance(d, dict) or not isinstance(d.get("decks", []), list) or (key and not re.fullmatch(r"[A-Za-z0-9_-]{24,100}", key)):
        return h.json({"erro": "Pedido inválido."}, 400)
    ext = hashlib.sha256(f"app:{key}".encode()).hexdigest() if key else f"g:{g['id']}"
    if key:  # liga o convite a esta app, se ela ainda não estiver ligada a outro amigo daqui
        con.execute("UPDATE friends SET ext=? WHERE id=? AND ext IS NULL AND NOT EXISTS (SELECT 1 FROM friends WHERE owner=? AND ext=?)",
                    (ext, g["id"], g["owner"], ext))
    ids = put_decks(con, g["owner"], g["id"], g["name"], ext, d.get("decks") or [])
    return h.json({"go": f"/convite/{token}?entrar=1", "ids": ids})


def _room(con, token):
    try:
        return con.execute("SELECT owner, status, json_extract(spec, '$.name'), json_extract(spec, '$.type'), json_extract(spec, '$.format'),"
                           " json_extract(spec, '$.casual'), json_extract(spec, '$.strict') FROM rooms WHERE json_extract(spec, '$.link')=?", (token,)).fetchone()
    except sqlite3.OperationalError:
        return None


def _page(h, body, code=200, L=None):
    """Uma página dos links (convite, sala, Taverna) na língua L, com o seletor de línguas no topo. Com ?lang= escolhida
    à mão, a app neste browser fica com ela (grimorio.lang)."""
    L = L or lang(h)
    qs = urllib.parse.parse_qsl(urllib.parse.urlsplit(h.path).query)
    keep = [(k, v) for k, v in qs if k == "volta"]
    chosen = any(k == "lang" and v.lower() in LANGS for k, v in qs)
    nav = "".join(f"<a href='?{html.escape(urllib.parse.urlencode(keep + [('lang', x)]))}' hreflang={c} lang={c}{' aria-current=true' if x == L else ''}>{n}</a>"
                  for x, (c, n) in LANGS.items())
    return h.send(code, (f"<!doctype html><html lang={LANGS[L][0]}><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
                         "<title>Grimório</title><body style='font:16px system-ui;padding:1.2em 1.2em 2em;max-width:34em;margin:auto;background:#0b0a14;color:#eee;line-height:1.45'>"
                         "<style>button,input{font:inherit;padding:.55em 1em;border-radius:10px;border:1px solid #555;background:#1d1a2e;color:#eee}"
                         "button.go,a.go{background:#f2b84b;color:#111;border:0;font-weight:700}a.go{display:inline-block;padding:.75em 1.3em;border-radius:12px;text-decoration:none;font-size:1.1em}a.alt{color:#f2b84b}.box{padding:.7em .9em;border-radius:12px;background:#1d1a2e;margin:1em 0}"
                         "small{color:#aaa}input[type=file]{max-width:100%;box-sizing:border-box}"
                         ".lg{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:.25em;font-size:.78em;margin:0 0 1.2em}"
                         ".lg a{color:#bbb;text-decoration:none;padding:.25em .55em;border-radius:99px;border:1px solid #2e2a44}"
                         ".lg a[aria-current]{color:#111;background:#f2b84b;border-color:#f2b84b;font-weight:700}</style>"
                         f"<nav class=lg aria-label='{html.escape(t(L, 'lang'))}'>{nav}</nav>"
                         + (f"<script>try{{localStorage.setItem('grimorio.lang','{L}')}}catch(e){{}}</script>" if chosen else "") + body).encode(), "text/html; charset=utf-8")


def _go(h, tok):
    return h.send(303, b"", "text/plain", {"Location": "/#online", "Set-Cookie": f"{COOKIE}={tok}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly"})


DECK_KEYS = ("name", "format", "main", "side", "commanders", "cover", "casual")


def clean_deck(d):
    """Um deck que chega de fora (outro Grimório, uma cópia .grimorio): só nome, formato e listas, com limites."""
    if not isinstance(d, dict):
        return None
    lst = lambda x, n: {str(k)[:150]: int(v) for k, v in list((x or {}).items())[:n] if isinstance(v, (int, float)) and 0 < v <= 250} if isinstance(x, dict) else {}  # noqa: E731
    main = lst(d.get("main"), 300)
    if not main:
        return None
    return {"name": str(d.get("name") or "Deck")[:120], "format": str(d.get("format") or "casual")[:30], "main": main, "side": lst(d.get("side"), 100),
            "commanders": [str(c)[:150] for c in (d.get("commanders") or [])[:2] if isinstance(c, str)], "cover": str(d.get("cover") or "")[:150] or None,
            "casual": bool(d.get("casual")), "src_id": str(d.get("id") or d.get("name") or "")[:80]}


_HITS = {}


def slow(key, n=12, per=60):
    """Limite simples por chave (convite, sala): n pedidos por minuto.
    ponytail: em memória e sem limpeza (uma chave por convite); passar para a DB se um dia houver milhares."""
    now = time.time()
    q = [t for t in _HITS.get(key, []) if now - t < per]
    _HITS[key] = q + [now]
    return len(q) >= n


def put_decks(con, owner, fid, name, key, decks):
    """Decks que um amigo traz (da app dele, de um ficheiro): ficam no anfitrião marcados como dele. O id sai da chave de
    origem + o id do deck lá: o mesmo deck atualiza-se em vez de se duplicar. Nunca toca num deck de outro dono.
    -> {id do deck lá: id aqui}"""
    now, out = time.time(), {}
    for d in [x for x in map(clean_deck, decks if isinstance(decks, list) else []) if x][:80]:
        src = d.pop("src_id")
        did = "x" + hashlib.sha1(f"{key}:{src}".encode()).hexdigest()[:30]
        r = con.execute("SELECT owner, json_extract(body, '$.created') FROM decks WHERE id=?", (did,)).fetchone()
        if r and r[0] != owner:
            continue
        body = {**d, "id": did, "friend": fid, "friendName": name, "count": sum(d["main"].values()), "created": (r and r[1]) or now}
        con.execute("INSERT OR REPLACE INTO decks (id, name, format, body, updated, owner, deleted) VALUES (?,?,?,?,?,?,NULL)",
                    (did, body["name"], body["format"], json.dumps(body, ensure_ascii=False), now, owner))
        out[src] = did
    return out


def link_friend(con, owner, ext, name, decks):
    """Amigo ligado a um perfil (deste Grimório, de outro, ou de uma cópia): reconhece-o pela chave `ext` (guarda-se o
    hash), põe-lhe o nome e os decks em dia (os mesmos decks de origem atualizam-se, não se duplicam) -> token do convite."""
    init(con)
    key = hashlib.sha256(ext.encode()).hexdigest()
    r = con.execute("SELECT id, token, revoked FROM friends WHERE owner=? AND ext=?", (owner, key)).fetchone()
    if r and r[2]:
        raise PermissionError("Este convite foi revogado por quem aloja.")
    name = re.sub(r"[<>&\"']", "", str(name or "")).strip()[:30] or "Amigo"
    if r:
        fid, tok = r[0], r[1]
        con.execute("UPDATE friends SET name=? WHERE id=?", (name, fid))
    else:
        fid, tok = secrets.token_hex(6), secrets.token_urlsafe(18)
        con.execute("INSERT INTO friends (id, owner, name, token, created, revoked, ext) VALUES (?,?,?,?,?,NULL,?)", (fid, owner, name, tok, time.time(), key))
    put_decks(con, owner, fid, name, key, decks)
    return tok


def room_link(h, con, token, name, me=None, act=""):
    """GET /sala/<token>[?nome=…]: o link de uma sala aberta (jogo avulso, torneio ou mesa livre). Quem já é deste Grimório
    entra logo: quem aloja vai para as salas; um perfil deste Grimório entra como ele, com os decks dele. Os outros
    escolhem: um nome (convidado novo), a cópia do seu Grimório (.grimorio) ou, numa app do Grimório, «Entrar numa sala»
    (leva o perfil e os decks dessa app). me = {owner, profile} de quem abre o link (None num endereço de convidados)."""
    r = _room(con, token)
    if act == "info":  # para a app de um amigo: que sala é (o formato pré-escolhe os decks a levar)
        return h.json({"api": API, "kind": "sala", "name": r[2], "type": r[3], "format": r[4], "casual": bool(r[5]), "hid": host_id(con)}) if r and r[1] == "open" \
            else h.json({"erro": "Esta sala já não está aberta."}, 404)
    L = lang(h)
    if not r or r[1] != "open" or act:
        return _page(h, f"<p>{t(L, 'room_bad')}</p>", 404, L)
    owner = r[0]
    g = by_token(con, cookie_token(h.headers))
    if g and g["owner"] == owner:  # já é convidado deste Grimório
        return h.send(302, b"", "text/plain", {"Location": "/#online"})
    if me and me.get("owner") == owner:  # quem aloja (ou o mesmo perfil)
        return h.send(302, b"", "text/plain", {"Location": "/#online"})
    name = re.sub(r"[<>&\"']", "", str(name or "")).strip()[:30]
    if not name:
        how = f"<div class=box>{t(L, ('strict' if r[6] else 'free') if r[3] == 'livre' else 'bots')}</div>"
        prof = me and me.get("profile")
        mine = (f"<form method=post action='/sala/{html.escape(token)}/perfil'><button class=go>{t(L, 'as_prof', n=prof['name'])}</button>"
                f" <small>{t(L, 'as_prof_s')}</small></form><p><small>{t(L, 'other')}</small></p>") if prof else ""
        js = json.dumps({k: t(L, k) for k in ("reading", "failed", "which")}, ensure_ascii=False).replace("<", "\\u003c")
        return _page(h, f"<h2>{'🃏' if r[3] == 'livre' else '🎲'} {html.escape(r[2] or t(L, 'room'))}</h2>{how}{'' if prof else app_btn(L)}{mine}"
                     f"<form><p>{t(L, 'room_p')}</p><input name=nome maxlength=30 required placeholder='{html.escape(t(L, 'name_ph'))}' style='width:100%;box-sizing:border-box'>"
                     f"<p><button class=go>{t(L, 'enter')}</button></p></form>"
                     f"<div class=box><b>{t(L, 'has_app')}</b><br><small>{t(L, 'room_app')}</small>"
                     f"<p><small>{t(L, 'copy')}</small><br>"
                     "<input type=file id=f accept='.grimorio'> <span id=st></span></p></div>"
                     f"<script>const T={js};f.onchange=async()=>{{const x=f.files[0];if(!x)return;st.textContent=T.reading;"
                     "const go=async q=>{const r=await fetch(location.pathname.replace(/\\/$/,'')+'/importar'+q,{method:'POST',body:x});const j=await r.json().catch(()=>({}));"
                     "if(!r.ok){st.textContent=j.erro||T.failed;return}if(j.go){location.href=j.go;return}"
                     "st.textContent=T.which;j.profiles.forEach(p=>{const b=document.createElement('button');b.textContent=`${p.name} (${p.decks})`;"
                     "b.onclick=()=>go('?perfil='+encodeURIComponent(p.id));st.append(b,' ')})};go('')}</script>", 200, L)
    init(con)
    fid, tok = secrets.token_hex(6), secrets.token_urlsafe(18)
    con.execute("INSERT INTO friends (id, owner, name, token, created, revoked) VALUES (?,?,?,?,?,NULL)", (fid, owner, f"{name} (sala)", tok, time.time()))
    return h.send(302, b"", "text/plain", {"Location": "/#online", "Set-Cookie": f"{COOKIE}={tok}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly"})


def room_post(h, con, token, act, me, data_dir):
    """POST /sala/<token>/perfil | /trazer | /importar — entrar ligado a um perfil (este Grimório, outro, uma cópia)."""
    r = _room(con, token)
    if not r or r[1] != "open":
        return h.json({"erro": "Esta sala já não está aberta."}, 404)
    owner = r[0]
    try:
        if act == "perfil":  # um perfil deste Grimório (mesmo browser): entra como ele, com os decks dele
            prof = me and me.get("profile")
            if not prof:
                return h.json({"erro": "Não há perfil escolhido neste browser."}, 400)
            decks = [json.loads(b) | {"id": i} for i, b in con.execute("SELECT id, body FROM decks WHERE owner=? AND deleted IS NULL ORDER BY updated DESC LIMIT 80", (prof["id"],))]
            return _go(h, link_friend(con, owner, f"local:{prof['id']}", prof["name"], [d for d in decks if not d.get("friend")]))
        if act == "trazer":  # outro Grimório (a app de um amigo): {name, key, decks}; a chave é dele e só ele a sabe
            d = h.body()
            key = str(d.get("key") or "")
            if not re.fullmatch(r"[A-Za-z0-9_-]{24,100}", key) or not isinstance(d.get("decks"), list):
                return h.json({"erro": "Pedido inválido."}, 400)
            if slow(("sala", token)):
                return h.json({"erro": "Demasiados pedidos: espera um minuto."}, 429)
            return h.json({"go": f"/convite/{link_friend(con, owner, 'app:' + key, d.get('name'), d['decks'])}?entrar=1"})
        if act == "importar":  # cópia .grimorio: escolhe-se um perfil lá dentro e entram o nome e os decks dele
            return _import(h, con, owner, data_dir)
    except PermissionError as e:
        return h.json({"erro": str(e)}, 403)
    except ValueError as e:
        return h.json({"erro": str(e)}, 400)
    return h.json({"erro": "rota desconhecida"}, 404)


def _import(h, con, owner, data_dir):
    import backup, tempfile, urllib.parse
    n = int(h.headers.get("Content-Length") or 0)
    if not 0 < n <= 60_000_000:
        return h.json({"erro": "Escolhe uma cópia .grimorio (até 60 MB)."}, 400)
    fd, tmp = tempfile.mkstemp(prefix="sala-", suffix=".grimorio", dir=data_dir)
    try:
        with os.fdopen(fd, "wb") as f:
            left = n
            while left > 0:
                b = h.rfile.read(min(1 << 20, left))
                if not b:
                    break
                f.write(b); left -= len(b)
        man, tmpdb, z = backup.open_zip(tmp, data_dir)  # valida (zip do Grimório, base sã); só se leem decks e nomes
        z.close()
        try:
            c = sqlite3.connect(tmpdb)
            rows = c.execute("SELECT id, owner, body FROM decks WHERE deleted IS NULL").fetchall()
            try:
                names = dict(c.execute("SELECT id, name FROM profiles").fetchall())
            except sqlite3.DatabaseError:
                names = {}
            c.close()
        finally:
            os.remove(tmpdb)
        by = {}
        for i, o, b in rows:
            d = json.loads(b)
            if not d.get("friend") and not d.get("community"):
                by.setdefault(o or "local", []).append(d | {"id": i})
        if not by:
            return h.json({"erro": "Esta cópia não tem decks."}, 400)
        want = urllib.parse.parse_qs(urllib.parse.urlsplit(h.path).query).get("perfil", [""])[0]
        if not want and len(by) > 1:
            return h.json({"profiles": [{"id": o, "name": names.get(o) or o, "decks": len(ds)} for o, ds in by.items()]})
        o = want if want in by else next(iter(by))
        dev = str(man.get("device") or "")[:60]
        return h.json({"go": f"/convite/{link_friend(con, owner, f'copia:{dev}:{o}', names.get(o) or o, by[o])}?entrar=1"})
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def visible(con, g, tid):
    """Um convidado vê os torneios do anfitrião onde entra um deck seu ou que estão abertos a amigos."""
    r = con.execute("SELECT state FROM tournaments WHERE id=? AND owner=?", (tid, g["owner"])).fetchone()
    if not r:
        return False
    st = json.loads(r[0])
    if st.get("friends_open"):
        return True
    mine = {d for (d,) in con.execute("SELECT id FROM decks WHERE owner=? AND json_extract(body, '$.friend')=?", (g["owner"], g["id"]))}
    return any(p.get("src") == "meus" and p.get("ref") in mine for p in st.get("players") or [])


def own(con, g, did):
    r = con.execute("SELECT body FROM decks WHERE id=? AND owner=?", (did, g["owner"])).fetchone()
    return r and json.loads(r[0]).get("friend") == g["id"]


def handle(h, method, g, db, tournament):
    """Pedido de um convidado: só a lista fechada; tudo o resto 403."""
    p = h.path.split("?")[0]
    deny = lambda: h.json({"erro": "Os convidados não podem fazer isto."}, 403)  # noqa: E731
    if p == "/api/guest/leave" and method == "POST":
        return h.send(200, b'{"ok": true}', "application/json", {"Set-Cookie": f"{COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly"})
    if p in ("/api/guest/me", "/api/me") and method == "GET":
        return h.json({"user": g["name"], "guest": {"id": g["id"], "name": g["name"]}, "api": API,
                       "invite": f"/convite/{cookie_token(h.headers) or bearer(h.headers)}"})  # o próprio link (para «Abrir na app»)
    if p == "/api/guest/decks" and method == "POST":  # trazer vários decks de uma vez (ficheiro da app, ou a app ao sentar-se)
        if slow(("decks", g["id"]), 30):
            return h.json({"erro": "Demasiados pedidos: espera um minuto."}, 429)
        try:
            d = h.body()
        except ValueError as e:
            return h.json({"erro": str(e)}, 400)
        if not isinstance(d, dict) or not isinstance(d.get("decks"), list):
            return h.json({"erro": "Pedido inválido."}, 400)
        with db() as con:
            ids = put_decks(con, g["owner"], g["id"], g["name"], f"g:{g['id']}", d["decks"])
        return h.json({"ids": ids, "n": len(ids)})
    if p == "/api/profiles" and method == "GET":
        return h.json({"mode": "guest", "current": {"id": None, "name": g["name"], "color": None}, "list": []})
    if p == "/api/decks" and method == "GET":
        return h._get()  # a lista filtra pelo convidado (H._as_guest)
    if p == "/api/decks" and method == "POST":
        return save(h, g, db, None)
    md = DECK.match(p)
    if md:
        did = md.group(1)
        with db() as con:
            mine = own(con, g, did)
        if method == "GET":
            return h._get() if mine else h.json({"erro": "deck não existe"}, 404)
        if method == "PUT":
            with db() as con:
                exists = con.execute("SELECT 1 FROM decks WHERE id=?", (did,)).fetchone()
            return save(h, g, db, did) if mine or not exists else deny()
        if method == "DELETE":
            if not mine:
                return deny()
            with db() as con:
                con.execute("UPDATE decks SET deleted=? WHERE id=? AND owner=?", (time.time(), did, g["owner"]))
            return h.json({"ok": True})
        return deny()
    if p.startswith("/api/rooms") and method in ("GET", "POST"):  # salas: ver as abertas, entrar/sair com um deck seu
        import rooms
        with db() as con:
            return h.json(*reversed(rooms.route(con, method, p, g["owner"], h.body() if method == "POST" else None, guest=g)))
    if (p == "/api/taverna" or p.startswith("/api/taverna/")) and method in ("GET", "POST"):  # a Taverna: só ações de membro (taverna.route)
        return h.taverna_route(method, p, g["owner"], f"guest:{g['id']}")
    if p.startswith("/api/freetables/") and method in ("GET", "POST"):  # mesa livre: só as mesas onde está sentado (freetable.route)
        return h.freetable_route(method, p, g["owner"], f"guest:{g['id']}")
    if re.fullmatch(r"/api/playnet/[a-f0-9]{12}(/cmd|/stop)?", p) and method in ("GET", "POST") and (method == "GET") != p.endswith(("/cmd", "/stop")):
        return h.playnet_route(method, f"{g['owner']}~guest:{g['id']}")  # só os jogos do Forge Play dele (torneio misto)
    bettor = f"guest:{g['id']}"
    if p in ("/api/tournaments/bets", "/api/tournaments/wallet-reset") and method in ("GET", "POST"):
        return h.json(*reversed(tournament.route(method, h.path, g["owner"], h.body() if method == "POST" else None, bettor=bettor)))
    if p == "/api/tournaments" and method == "GET":
        code, rows = tournament.route("GET", h.path, g["owner"])
        with db() as con:
            rows = [r for r in rows if visible(con, g, r["id"])] if code == 200 else rows
        return h.json(rows, code)
    mt = TOUR.match(p)
    if mt:
        with db() as con:
            ok = visible(con, g, mt.group(1))
        sub = (mt.group(2) or "").strip("/")
        # ready: mesa livre; play: o seu jogo no Forge Play (a rota vê se joga a partida)
        if not ok or not (method == "GET" or (method == "POST" and sub in ("bets", "ready", "play"))):
            return deny()
        return h.json(*reversed(tournament.route(method, h.path, g["owner"], h.body() if method == "POST" else None, bettor=bettor)))
    if method in ("GET", "HEAD") and (p.startswith(PASS_GET) or not p.startswith(("/api/", "/play", "/convite"))):
        return h._get()
    return deny()


def save(h, g, db, did):
    """Deck do convidado: guardado no anfitrião, sempre marcado como dele."""
    try:
        d = h.body()
    except ValueError as e:
        return h.json({"erro": str(e)}, 400)
    if not isinstance(d, dict):
        return h.json({"erro": "deck inválido"}, 400)
    d.update(id=did or str(uuid.uuid4()), friend=g["id"], friendName=g["name"])
    d.pop("community", None)
    return h.save(d, 200 if did else 201)
