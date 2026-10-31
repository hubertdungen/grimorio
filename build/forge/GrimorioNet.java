// Grimório — Forge Play nativo (Forge 2.0.15, GPL-3.0): joga-se pelo browser, sem a janela do Forge.
// Arranca um jogo 1 contra 1 (humano contra a IA) e faz de «ecrã» do humano: implementa o IGuiGame (o mesmo papel que o
// cliente do jogo em rede do Forge), escreve o que o motor mostra em linhas JSON e recebe as ações do browser.
//   saída (stdout):  @@GN {"t":"state",...}  estado do jogo (zonas, vida, pilha, fase, combate), no máximo ~7x por segundo
//                    @@GN {"t":"prompt","msg":...,"buttons":[...],"sel":[ids]}   o que o motor espera agora
//                    @@GN {"t":"ask","id":N,"kind":...}   uma escolha que bloqueia o motor até à resposta
//                    @@GN {"t":"end","winner":...}
//   entrada (stdin): {"c":"ok"} {"c":"cancel"} {"c":"card","id":N} {"c":"player","i":N} {"c":"answer","id":N,"v":...}
//                    {"c":"mana","color":N} {"c":"alpha"} {"c":"concede"} {"c":"undo"}
// Uso: java -cp forge.jar:forge-ext GrimorioNet humano.dck ia.dck NomeHumano PerfilIA
import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

import com.google.gson.*;

import forge.GuiDesktop;
import forge.LobbyPlayer;
import forge.deck.CardPool;
import forge.deck.Deck;
import forge.deck.io.DeckSerializer;
import forge.game.GameEntityView;
import forge.game.GameType;
import forge.game.GameView;
import forge.game.card.CardView;
import forge.game.card.CounterType;
import forge.game.combat.CombatView;
import forge.game.phase.PhaseType;
import forge.game.player.DelayedReveal;
import forge.game.player.PlayerView;
import forge.game.player.RegisteredPlayer;
import forge.game.spellability.SpellAbilityView;
import forge.game.spellability.StackItemView;
import forge.game.zone.ZoneType;
import forge.gamemodes.match.AbstractGuiGame;
import forge.gamemodes.match.HostedMatch;
import forge.gui.GuiBase;
import forge.gui.interfaces.IGuiGame;
import forge.interfaces.IGameController;
import forge.item.PaperCard;
import forge.localinstance.skin.FSkinProp;
import forge.model.FModel;
import forge.player.GamePlayerUtil;
import forge.trackable.TrackableCollection;
import forge.util.FSerializableFunction;
import forge.util.ITriggerEvent;
import forge.LobbyPlayer;
import forge.util.collect.FCollectionView;
import forge.game.GameState;
import forge.game.GameEntityView;
import forge.game.player.IHasIcon;

public class GrimorioNet {
    static final Gson G = new GsonBuilder().disableHtmlEscaping().create();

    static void send(JsonObject o) {
        synchronized (GrimorioNet.class) {
            System.out.println("@@GN " + G.toJson(o));
            System.out.flush();
        }
    }

    static HostedMatch HM;  // o jogo a sério (não só as vistas): para saber que cartas se podem jogar agora

    public static void main(String[] a) throws Exception {
        if (System.getProperty("java.awt.headless") == null) System.setProperty("java.awt.headless", "true");
        Thread.setDefaultUncaughtExceptionHandler((t, ex) -> { System.err.println("Uncaught exception in thread " + t.getName() + ":"); ex.printStackTrace(); });
        System.setProperty("java.util.Arrays.useLegacyMergeSort", "true");
        GuiBase.setInterface(new GuiDesktop());
        FModel.initialize(null, null);
        // sem placa de som no contentor: som e música desligados (senão enchem o registo de erros)
        FModel.getPreferences().setPref(forge.localinstance.properties.ForgePreferences.FPref.UI_ENABLE_SOUNDS, false);
        FModel.getPreferences().setPref(forge.localinstance.properties.ForgePreferences.FPref.UI_ENABLE_MUSIC, false);
        // procurar na biblioteca, scry, vigiar…: com isto ligado (o padrão do desktop) o Forge mostra a zona numa janela e
        // espera um clique lá; desligado pergunta por listas (getChoices/many/order), que o browser mostra como escolhas
        FModel.getPreferences().setPref(forge.localinstance.properties.ForgePreferences.FPref.UI_SELECT_FROM_CARD_DISPLAYS, false);
        Deck dh = DeckSerializer.fromFile(new File(a[0])), da = DeckSerializer.fromFile(new File(a[1]));
        LobbyPlayer human = GamePlayerUtil.getGuiPlayer();
        human.setName(a.length > 2 ? a[2] : "Tu");
        LobbyPlayer ai = GamePlayerUtil.createAiPlayer(a.length > 4 ? a[4] : "Forge", a.length > 3 ? a[3] : "Default");  // nome (o deck dele), perfil
        RegisteredPlayer rh = new RegisteredPlayer(dh), ra = new RegisteredPlayer(da);
        List<RegisteredPlayer> players = new ArrayList<>();
        players.add(rh.setPlayer(human));
        players.add(ra.setPlayer(ai));
        Bridge gui = new Bridge();
        Thread in = new Thread(() -> gui.readCommands(), "grimorio-in");
        in.setDaemon(true);
        in.start();
        HostedMatch hm = new HostedMatch();  // sem o GuiDesktop.hostMatch (precisa da janela Swing)
        HM = hm;
        hm.startMatch(GameType.Constructed, EnumSet.noneOf(GameType.class), players, rh, gui);
        // o jogo corre noutras threads; esta espera pelo fim (o Bridge sai do processo em finishGame/afterGameEnd)
        while (true) Thread.sleep(1000);
    }

    // ---------- o «ecrã» do humano ----------
    static class Bridge extends AbstractGuiGame {
        final Map<Integer, CompletableFuture<JsonElement>> asks = new ConcurrentHashMap<>();
        int askSeq = 0;
        volatile boolean dirty = true;
        volatile JsonObject lastPrompt = new JsonObject();
        final Set<Integer> selectable = ConcurrentHashMap.newKeySet();

        Bridge() {
            ScheduledExecutorService ex = Executors.newSingleThreadScheduledExecutor(r -> { Thread t = new Thread(r, "grimorio-state"); t.setDaemon(true); return t; });
            // também sem «dirty»: no fim do jogo o Forge corre as conquistas na EDT e rebenta sem a imagem do troféu
            // (IMG_COMMON_TROPHY, não há skin sem janela) antes de chamar o finishGame; o fim sai daqui pelo estado
            ex.scheduleAtFixedRate(() -> { try { GameView gv = getGameView(); if (dirty || (!ended && gv != null && gv.isGameOver())) { dirty = false; sendState(); } } catch (Exception e) { e.printStackTrace(); } }, 300, 150, TimeUnit.MILLISECONDS);
        }

        IGameController ctl() { return getGameController(); }

        void command(JsonObject c, String line) {
            busy.incrementAndGet();
            calc.lock(); calc.unlock();  // um cálculo das jogáveis a meio acaba antes de o clique soltar o jogo
            try {
                String k = c.get("c").getAsString();
                switch (k) {
                    case "ok": ctl().selectButtonOk(); break;
                    case "cancel": ctl().selectButtonCancel(); break;
                    case "card": { CardView cv = findCard(c.get("id").getAsInt()); if (cv != null) ctl().selectCard(cv, null, null); break; }
                    case "player": { PlayerView pv = getGameView().getPlayers().get(c.get("i").getAsInt()); ctl().selectPlayer(pv, null); break; }
                    case "mana": { int mc = "WUBRGC".indexOf(c.get("color").getAsString()); if (mc >= 0) ctl().useMana(forge.card.MagicColor.WUBRGC[mc]); break; }
                    case "alpha": ctl().alphaStrike(); break;
                    case "undo": ctl().undoLastAction(); break;
                    case "concede": ctl().concede(); break;
                    case "state": dirty = true; send(lastPrompt); break;
                    default: break;
                }
            } catch (Exception e) {
                System.err.println("comando inválido: " + line);
                e.printStackTrace();
            } finally {
                busy.decrementAndGet();
            }
        }

        // --- comandos do browser ---
        // As respostas (answer) tratam-se aqui mesmo; o resto corre numa thread própria, por ordem. Um clique pode ficar à
        // espera de uma escolha dentro do próprio selectCard (getAbilityToPlay: jogar o terreno ou ciclar, Shattered
        // Landscape); se corresse nesta thread, ninguém lia a resposta e o jogo congelava.
        final ExecutorService cmds = Executors.newSingleThreadExecutor(r -> { Thread t = new Thread(r, "grimorio-cmd"); t.setDaemon(true); return t; });
        void readCommands() {
            try (BufferedReader r = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8))) {
                for (String line; (line = r.readLine()) != null; ) {
                    line = line.trim();
                    if (line.isEmpty()) continue;
                    final String ln = line;
                    try {
                        JsonObject c = JsonParser.parseString(line).getAsJsonObject();
                        if ("answer".equals(c.get("c").getAsString())) {
                            CompletableFuture<JsonElement> f = asks.remove(c.get("id").getAsInt());
                            if (f != null) f.complete(c.get("v"));
                            continue;
                        }
                        cmds.submit(() -> command(c, ln));
                    } catch (Exception e) {
                        System.err.println("comando inválido: " + line);
                        e.printStackTrace();
                    }
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
            System.exit(0);  // o browser/servidor fechou a ligação: acaba o jogo
        }

        CardView findCard(int id) {
            GameView gv = getGameView();
            if (gv == null) return null;
            for (PlayerView p : gv.getPlayers()) {
                for (ZoneType z : new ZoneType[]{ZoneType.Hand, ZoneType.Battlefield, ZoneType.Graveyard, ZoneType.Exile, ZoneType.Command, ZoneType.Library}) {
                    FCollectionView<CardView> cs = zone(p, z);
                    if (cs != null) for (CardView cv : cs) if (cv.getId() == id) return cv;
                }
            }
            for (StackItemView si : gv.getStack()) if (si.getSourceCard() != null && si.getSourceCard().getId() == id) return si.getSourceCard();
            return null;
        }

        static FCollectionView<CardView> zone(PlayerView p, ZoneType z) {
            switch (z) {
                case Hand: return p.getHand();
                case Battlefield: return p.getBattlefield();
                case Graveyard: return p.getGraveyard();
                case Exile: return p.getExile();
                case Command: return p.getCommand();
                case Library: return p.getLibrary();
                default: return null;
            }
        }

        // --- estado do jogo em JSON ---
        JsonObject card(CardView c, boolean hidden) {
            JsonObject o = new JsonObject();
            o.addProperty("id", c.getId());
            if (hidden) { o.addProperty("hidden", true); return o; }
            CardView.CardStateView s = c.getCurrentState();
            forge.game.card.Card rc = real.get(c.getId());  // a carta do jogo (só as do campo): o que a vista não diz
            if (c.isFaceDown() && !mayView(c)) o.addProperty("hidden", true);  // morph/manifest/disfarce do adversário: sem nome, mas à vista (virada, 2/2, marcadores)
            else if (c.isFaceDown()) {  // a tua virada para baixo: o nome verdadeiro (só tu o vês)
                String n = rc != null ? rc.getState(forge.card.CardStateName.Original).getName() : c.getAlternateState() != null ? c.getAlternateState().getName() : s.getName();
                o.addProperty("name", n);
            } else { o.addProperty("name", s.getName()); o.addProperty("set", s.getSetCode()); }
            if (c.isTapped()) o.addProperty("tapped", true);
            if (c.isSick() && s.isCreature()) o.addProperty("sick", true);
            if (s.isCreature()) { JsonArray pt = new JsonArray(); pt.add(s.getPower()); pt.add(s.getToughness()); o.add("pt", pt); }
            if (s.isLand()) o.addProperty("land", true);
            if (s.isCreature()) o.addProperty("creature", true);
            if (s.isPlaneswalker()) o.addProperty("loyalty", s.getLoyalty());
            if (c.getDamage() > 0) o.addProperty("dmg", c.getDamage());
            if (c.isToken()) o.addProperty("token", true);
            if (c.isFaceDown()) o.addProperty("faceDown", true);
            String stn = s.getState().toString();  // a outra face à vista: transformada, flip (Kamigawa), MDFC jogada por trás, fundida
            if (c.isFlipped() || stn.equals("Transformed") || stn.equals("Flipped") || stn.equals("Modal") || stn.equals("Meld")) o.addProperty("flipped", true);
            if (rc != null) {
                try {
                    if (rc.isPhasedOut()) o.addProperty("phased", true);
                    if (rc.isGoaded()) o.addProperty("goad", true);
                    if (rc.getCopiedPermanent() != null || c.isCloned()) o.addProperty("copy", true);
                    if (rc.getMergedCards() != null && rc.getMergedCards().size() > 1) { JsonArray m = new JsonArray(); for (forge.game.card.Card x : rc.getMergedCards()) m.add(x.getName()); o.add("merged", m); }
                } catch (Exception e) { System.err.println("card: " + e); }
            }
            if (c.getAttachedTo() != null) o.addProperty("attachedTo", c.getAttachedTo().getId());
            if (c.getController() != null) o.addProperty("ctrl", c.getController().getId());
            com.google.common.collect.Multiset<CounterType> ct = c.getCounters();
            if (ct != null && !ct.isEmpty()) {
                JsonObject co = new JsonObject();
                for (CounterType t : ct.elementSet()) co.addProperty(t.getName(), ct.count(t));
                o.add("counters", co);
            }
            if (selectable.contains(c.getId())) o.addProperty("sel", true);
            if (isHighlighted(c)) o.addProperty("picked", true);  // já escolhida nesta escolha (descartar 2, sacrificar…): o motor marca-a no ecrã
            if (playable.contains(c.getId())) o.addProperty("play", true);
            return o;
        }

        // zona de comando: emblemas e masmorras (com a sala atual); os efeitos internos do Forge (monarca, iniciativa…) ficam de fora
        JsonArray command(PlayerView p) {
            JsonArray a = new JsonArray();
            if (p.getCommand() != null) for (CardView c : p.getCommand()) {
                String room = c.getCurrentRoom();
                if (!c.isEmblem() && room == null && !c.isCommander()) continue;
                JsonObject o = new JsonObject();
                o.addProperty("id", c.getId());
                o.addProperty("name", c.getCurrentState().getName());
                if (c.isEmblem()) o.addProperty("emblem", true);
                if (room != null) o.addProperty("room", room);
                a.add(o);
            }
            return a;
        }

        JsonArray cards(Iterable<CardView> cs, boolean hidden) {
            JsonArray a = new JsonArray();
            if (cs != null) for (CardView c : cs) a.add(card(c, hidden));
            return a;
        }

        // cartas que o humano pode jogar já, com mana para as pagar (mão, cemitério com flashback, exílio, comando).
        // Só com a prioridade do humano: aí a thread do jogo está parada à espera dele e o estado não muda a meio.
        Set<Integer> playable = new HashSet<>();
        volatile boolean pfail;  // o cálculo falhou: a mesa não bloqueia (o Forge decide)
        // O cálculo lê cartas que o Forge também mexe (getAllPossibleAbilities refaz as caches de palavras-chave): fora da
        // thread do jogo só é seguro com ela parada à espera da prioridade do humano (InputPassPriority na fila). Antes
        // corria a qualquer altura e, a meio da pilha, partiu a TreeMap das palavras-chave e matou a thread do jogo
        // («o adversário está a pensar» para sempre). Um clique que chega a meio espera que o cálculo acabe (calc).
        final java.util.concurrent.locks.ReentrantLock calc = new java.util.concurrent.locks.ReentrantLock();
        final java.util.concurrent.atomic.AtomicInteger busy = new java.util.concurrent.atomic.AtomicInteger();
        Set<Integer> playableNow() {
            if (!calc.tryLock()) return playable;
            try {
                if (busy.get() > 0) return playable;  // um clique está a soltar o jogo: fica o que havia
                pfail = false;
                return playableOnce();
            } catch (Exception e) {
                System.err.println("playable: " + e);
                pfail = true;
                return playable;
            } finally {
                calc.unlock();
            }
        }
        static boolean waiting(forge.game.player.Player me) {
            return me.getController() instanceof forge.player.PlayerControllerHuman h
                    && h.getInputQueue().getInput() instanceof forge.gamemodes.match.input.InputPassPriority;
        }
        Set<Integer> playableOnce() {
            Set<Integer> out = new HashSet<>();
            forge.game.Game g = HM == null ? null : HM.getGame();
            PlayerView pv = getCurrentPlayer();
            if (g == null || pv == null) return out;
            forge.game.player.Player me = null;
            for (forge.game.player.Player p : new ArrayList<>(g.getPlayers())) if (p.getId() == pv.getId()) me = p;
            if (me == null) return out;
            // a prioridade do jogo (a da vista do jogador atualiza-se depois do pedido e chegava tarde)
            if (g.getPhaseHandler().getPriorityPlayer() != me) return out;
            if (!waiting(me)) return out;  // o jogo não está parado à espera da minha prioridade
            for (ZoneType z : new ZoneType[]{ZoneType.Hand, ZoneType.Graveyard, ZoneType.Exile, ZoneType.Command})
                for (forge.game.card.Card c : new ArrayList<>(me.getCardsIn(z)))
                    for (forge.game.spellability.SpellAbility sa : new ArrayList<>(c.getAllPossibleAbilities(me, true))) {
                        if (sa.isManaAbility()) continue;
                        if (sa.isLandAbility() || forge.ai.ComputerUtilMana.canPayManaCost(sa, me, 0, false)) { out.add(c.getId()); break; }
                    }
            return out;
        }

        Map<Integer, forge.game.card.Card> real = new HashMap<>();  // id -> carta do jogo, no campo (fora de fase incluídas)

        void sendState() {
            GameView gv = getGameView();
            if (gv == null) return;
            playable = playableNow();
            forge.game.Game game = HM == null ? null : HM.getGame();
            Map<Integer, forge.game.card.Card> rm = new HashMap<>();
            try { if (game != null) for (forge.game.card.Card x : game.getCardsIncludePhasingIn(ZoneType.Battlefield)) rm.put(x.getId(), x); } catch (Exception e) { System.err.println("real: " + e); }
            real = rm;
            JsonObject o = new JsonObject();
            o.addProperty("t", "state");
            if (pfail) o.addProperty("pfail", true);
            o.addProperty("turn", gv.getTurn());
            if (gv.getPhase() != null) o.addProperty("phase", gv.getPhase().name());
            if (gv.getPlayerTurn() != null) o.addProperty("active", gv.getPlayerTurn().getId());
            JsonArray ps = new JsonArray();
            PlayerView me = getCurrentPlayer();
            for (PlayerView p : gv.getPlayers()) {
                JsonObject po = new JsonObject();
                po.addProperty("id", p.getId());
                po.addProperty("name", p.getLobbyPlayerName());
                po.addProperty("life", p.getLife());
                po.addProperty("ai", p.isAI());
                po.addProperty("me", me != null && p.getId() == me.getId());
                if (p.getHasPriority()) po.addProperty("priority", true);
                po.addProperty("library", p.getLibrary() == null ? 0 : p.getLibrary().size());
                boolean mine = me != null && p.getId() == me.getId();
                po.add("hand", cards(p.getHand(), !mine));
                JsonObject mp = new JsonObject();  // reserva de mana: {"W": 1, "C": 2}
                for (int k = 0; k < 6; k++) { int n = p.getMana(forge.card.MagicColor.WUBRGC[k]); if (n > 0) mp.addProperty(String.valueOf("WUBRGC".charAt(k)), n); }
                if (mp.size() > 0) po.add("mana", mp);
                po.add("battlefield", cards(p.getBattlefield(), false));
                po.add("graveyard", cards(p.getGraveyard(), false));
                po.add("exile", cards(p.getExile(), false));
                po.add("command", command(p));
                forge.game.player.Player rp = null;
                if (game != null) for (forge.game.player.Player x : game.getPlayers()) if (x.getId() == p.getId()) rp = x;
                if (rp != null) try {  // designações: monarca, iniciativa, bênção da cidade, velocidade
                    if (rp.isMonarch()) po.addProperty("monarch", true);
                    if (rp.hasInitiative()) po.addProperty("initiative", true);
                    if (rp.hasBlessing()) po.addProperty("blessing", true);
                    if (!rp.noSpeed()) po.addProperty("speed", rp.getSpeed());
                } catch (Exception e) { System.err.println("designações: " + e); }
                com.google.common.collect.Multiset<CounterType> pc = p.getCounters();
                if (pc != null && !pc.isEmpty()) { JsonObject co = new JsonObject(); for (CounterType t : pc.elementSet()) co.addProperty(t.getName(), pc.count(t)); po.add("counters", co); }
                ps.add(po);
            }
            o.add("players", ps);
            try { if (game != null && game.getDayTime() != null) o.addProperty("day", game.isDay() ? "day" : "night"); } catch (Exception e) { System.err.println("dia/noite: " + e); }
            JsonArray st = new JsonArray();
            for (StackItemView si : gv.getStack()) {
                JsonObject so = new JsonObject();
                so.addProperty("text", si.getText());
                if (si.getSourceCard() != null) { so.addProperty("card", si.getSourceCard().getId()); so.addProperty("name", si.getSourceCard().getCurrentState().getName()); }
                if (si.getActivatingPlayer() != null) so.addProperty("by", si.getActivatingPlayer().getId());
                so.addProperty("ability", si.isAbility());
                st.add(so);
            }
            o.add("stack", st);
            CombatView cb = gv.getCombat();
            if (cb != null) {
                JsonArray ca = new JsonArray();
                for (CardView at : cb.getAttackers()) {
                    JsonObject x = new JsonObject();
                    x.addProperty("att", at.getId());
                    GameEntityView d = cb.getDefender(at);
                    if (d != null) x.addProperty("def", d.getId());
                    if (d instanceof CardView) x.addProperty("defc", ((CardView) d).getCurrentState().getName());  // ataca um planeswalker ou uma batalha
                    JsonArray bl = new JsonArray();
                    // a declarar bloqueadores, o CombatView só se atualiza no fim: os bloqueios vêm do combate a decorrer
                    // (sem isto o bloqueio não aparecia e um segundo clique desfazia-o sem se ver)
                    boolean live = false;
                    try {
                        forge.game.combat.Combat lc = game == null ? null : game.getCombat();
                        forge.game.card.Card ac = lc == null ? null : game.findById(at.getId());
                        if (ac != null && lc.isAttacking(ac)) { for (forge.game.card.Card b : lc.getBlockers(ac)) bl.add(b.getId()); live = true; }
                    } catch (Exception e) { bl = new JsonArray(); }
                    if (!live && cb.getBlockers(at) != null) for (CardView b : cb.getBlockers(at)) bl.add(b.getId());
                    x.add("blockers", bl);
                    ca.add(x);
                }
                o.add("combat", ca);
            }
            if (gv.isGameOver()) { o.addProperty("over", true); o.addProperty("winner", gv.getWinningPlayerName()); }
            boolean endNow = gv.isGameOver() && !ended;
            // o registo do jogo (o mesmo do painel do Forge): as últimas 40 entradas, com o id da carta de cada uma
            if (gv.getGameLog() != null) {
                java.util.List<forge.game.GameLogEntry> es = new ArrayList<>();  // do mais antigo para o mais recente, sem as fases
                for (forge.game.GameLogEntry e : gv.getGameLog().getAllEntries()) if (e.type() != forge.game.GameLogEntryType.PHASE) es.add(e);
                JsonArray lg = new JsonArray();
                for (int k = Math.max(0, es.size() - 40); k < es.size(); k++) {
                    forge.game.GameLogEntry e = es.get(k);
                    JsonObject le = new JsonObject();
                    le.addProperty("m", e.message());
                    le.addProperty("y", e.type().name());
                    if (e.sourceCard() != null) le.addProperty("c", e.sourceCard().getId());
                    lg.add(le);
                }
                o.add("log", lg);
                o.addProperty("logN", es.size());
            }
            send(o);
            if (endNow) finishGame();
        }

        // --- pedidos que bloqueiam o motor até o browser responder ---
        JsonElement ask(String kind, JsonObject payload) {
            int id;
            synchronized (this) { id = ++askSeq; }
            CompletableFuture<JsonElement> f = new CompletableFuture<>();
            asks.put(id, f);
            payload.addProperty("t", "ask");
            payload.addProperty("id", id);
            payload.addProperty("kind", kind);
            dirty = true;
            send(payload);
            try { return f.get(); } catch (Exception e) { return JsonNull.INSTANCE; }
        }

        static String label(Object x) {
            if (x instanceof CardView) return ((CardView) x).getCurrentState().getName();
            if (x instanceof PlayerView) return ((PlayerView) x).getLobbyPlayerName();
            if (x instanceof SpellAbilityView) return ((SpellAbilityView) x).getDescription();
            if (x instanceof StackItemView) return ((StackItemView) x).getText();  // alvo na pilha (Counterspell, Negate, Stifle…)
            return String.valueOf(x);
        }

        <T> JsonArray options(List<T> xs, FSerializableFunction<T, String> display) {
            JsonArray a = new JsonArray();
            for (T x : xs) {
                JsonObject o = new JsonObject();
                o.addProperty("label", display != null ? display.apply(x) : label(x));
                if (x instanceof CardView) o.addProperty("card", ((CardView) x).getId());
                if (x instanceof PlayerView) o.addProperty("player", ((PlayerView) x).getId());
                if (x instanceof StackItemView && ((StackItemView) x).getSourceCard() != null) {  // a mesa mostra a carta do feitiço na pilha
                    CardView sc = ((StackItemView) x).getSourceCard();
                    o.addProperty("card", sc.getId()); o.addProperty("name", sc.getCurrentState().getName()); o.addProperty("stack", true);
                }
                a.add(o);
            }
            return a;
        }

        static List<Integer> idx(JsonElement v) {
            List<Integer> out = new ArrayList<>();
            if (v == null || v.isJsonNull()) return out;
            if (v.isJsonArray()) for (JsonElement e : v.getAsJsonArray()) out.add(e.getAsInt());
            else if (v.isJsonPrimitive()) out.add(v.getAsInt());
            return out;
        }

        // ---------- IGuiGame ----------
        @Override protected void updateCurrentPlayer(PlayerView p) { dirty = true; }
        @Override public void openView(TrackableCollection<PlayerView> ps) { JsonObject o = new JsonObject(); o.addProperty("t", "open"); send(o); dirty = true; }
        @Override public void showCombat() { dirty = true; }
        @Override public void showPromptMessage(PlayerView p, String msg, CardView card) {
            dirty = true;  // cada pedido novo leva o estado do jogo atrás
            JsonObject o = lastPrompt.deepCopy();
            o.addProperty("t", "prompt");
            o.addProperty("msg", msg);
            if (card != null) o.addProperty("card", card.getId()); else o.remove("card");
            if (card != null && mayView(card)) o.addProperty("cardName", card.getCurrentState().getName()); else o.remove("cardName");  // vigiar/vidência de 1: a carta vem da biblioteca
            lastPrompt = o;
            send(o);
        }
        @Override public void updateButtons(PlayerView p, String l1, String l2, boolean e1, boolean e2, boolean focus1) {
            dirty = true;  // botões novos = a vez mudou: o estado (prioridade, cartas jogáveis) vai atrás
            JsonObject o = lastPrompt.deepCopy();
            o.addProperty("t", "prompt");
            JsonArray b = new JsonArray();
            JsonObject b1 = new JsonObject(); b1.addProperty("label", l1); b1.addProperty("on", e1); b1.addProperty("c", "ok"); b.add(b1);
            JsonObject b2 = new JsonObject(); b2.addProperty("label", l2); b2.addProperty("on", e2); b2.addProperty("c", "cancel"); b.add(b2);
            o.add("buttons", b);
            lastPrompt = o;
            send(o);
        }
        @Override public void setSelectables(Iterable<CardView> cs, int min, int max) {
            super.setSelectables(cs, min, max);
            selectable.clear();
            if (cs != null) for (CardView c : cs) selectable.add(c.getId());
            dirty = true;
        }
        @Override public void clearSelectables() { super.clearSelectables(); selectable.clear(); dirty = true; }
        @Override public void setHighlighted(Iterable<GameEntityView> ges, boolean on) { super.setHighlighted(ges, on); dirty = true; }
        @Override public void flashIncorrectAction() { JsonObject o = new JsonObject(); o.addProperty("t", "flash"); send(o); }
        @Override public void alertUser() { }
        volatile boolean ended = false;  // o fim só se manda uma vez (pelo finishGame do Forge ou pelo estado que já diz «acabou»)
        @Override public synchronized void finishGame() { if (ended) return; ended = true; dirty = true; sendState(); JsonObject o = new JsonObject(); o.addProperty("t", "end"); GameView gv = getGameView(); if (gv != null) o.addProperty("winner", gv.getWinningPlayerName()); send(o); new Thread(() -> { try { Thread.sleep(1500); } catch (InterruptedException e) { } System.exit(0); }).start(); }
        @Override public void afterGameEnd() { finishGame(); }
        @Override public GameState getGamestate() { return null; }
        @Override public boolean isUiSetToSkipPhase(PlayerView turn, PhaseType phase) {
            // pára só onde costuma haver decisões: as duas fases principais, atacar (no teu turno) e bloquear (no do outro)
            PlayerView me = getCurrentPlayer();
            boolean mine = me != null && turn != null && turn.getId() == me.getId();
            switch (phase) {
                case MAIN1: case MAIN2: return false;
                case COMBAT_DECLARE_ATTACKERS: return !mine;
                case COMBAT_DECLARE_BLOCKERS: return mine;
                case END_OF_TURN: return mine;  // no fim do turno do adversário dá para lançar instantâneos
                default: return true;
            }
        }
        @Override public void setCard(CardView c) { }
        @Override public void setPanelSelection(CardView c) { }
        @Override public void setPlayerAvatar(LobbyPlayer p, IHasIcon i) { }
        @Override public void message(String msg, String title) { JsonObject o = new JsonObject(); o.addProperty("t", "msg"); o.addProperty("msg", msg); o.addProperty("title", title); send(o); }
        @Override public void showErrorDialog(String msg, String title) { message(msg, title); }
        @Override public boolean showConfirmDialog(String msg, String title, String yes, String no, boolean defYes) {
            JsonObject p = new JsonObject(); p.addProperty("msg", msg); p.addProperty("title", title);
            JsonArray o = new JsonArray(); o.add(yes); o.add(no); p.add("options", o);
            List<Integer> r = idx(ask("confirm", p));
            return r.isEmpty() ? defYes : r.get(0) == 0;
        }
        @Override public int showOptionDialog(String msg, String title, FSkinProp icon, List<String> opts, int def) {
            JsonObject p = new JsonObject(); p.addProperty("msg", msg); p.addProperty("title", title);
            JsonArray o = new JsonArray(); for (String s : opts) o.add(s); p.add("options", o);
            List<Integer> r = idx(ask("option", p));
            return r.isEmpty() ? def : r.get(0);
        }
        @Override public String showInputDialog(String msg, String title, FSkinProp icon, String initial, List<String> opts, boolean numeric) {
            JsonObject p = new JsonObject(); p.addProperty("msg", msg); p.addProperty("title", title); p.addProperty("initial", initial); p.addProperty("numeric", numeric);
            if (opts != null) { JsonArray o = new JsonArray(); for (String s : opts) o.add(s); p.add("options", o); }
            JsonElement v = ask("input", p);
            return v == null || v.isJsonNull() ? null : v.getAsString();
        }
        @Override public boolean confirm(CardView c, String question, boolean defYes, List<String> opts) {
            JsonObject p = new JsonObject(); p.addProperty("msg", question); if (c != null) { p.addProperty("card", c.getId()); if (mayView(c)) p.addProperty("cardName", c.getCurrentState().getName()); }
            JsonArray o = new JsonArray(); if (opts != null && opts.size() >= 2) { o.add(opts.get(0)); o.add(opts.get(1)); } else { o.add("Sim"); o.add("Não"); } p.add("options", o);
            List<Integer> r = idx(ask("confirm", p));
            return r.isEmpty() ? defYes : r.get(0) == 0;
        }
        @Override public <T> List<T> getChoices(String msg, int min, int max, List<T> choices, List<T> selected, FSerializableFunction<T, String> display) {
            if (choices == null || choices.isEmpty()) return new ArrayList<>();
            if (min < 0 || max < 0) {  // lista só para ler (avisos, cartas reveladas): mostra-se e não se espera resposta
                JsonObject o = new JsonObject(); o.addProperty("t", "msg"); o.addProperty("title", msg);
                JsonArray l = new JsonArray(); for (T x : choices) l.add(display != null ? display.apply(x) : label(x)); o.add("list", l);
                send(o);
                return new ArrayList<>();
            }
            if (min == 1 && max == 1 && choices.size() == 1) return new ArrayList<>(choices);
            JsonObject p = new JsonObject(); p.addProperty("msg", msg); p.addProperty("min", min); p.addProperty("max", max); p.add("options", options(choices, display));
            List<T> out = new ArrayList<>();
            for (int i : idx(ask("choose", p))) if (i >= 0 && i < choices.size()) out.add(choices.get(i));
            return out;
        }
        @Override public <T> List<T> many(String title, String top, int min, int max, List<T> source, List<T> dest, CardView ref) {
            // -1 = «quantas quiseres» (scry: as que vão para o fundo; vigiar: as que vão para o cemitério)
            if (min < 0 || max < 0) { min = 0; max = source == null ? 0 : source.size(); }
            if (source == null || source.isEmpty()) return new ArrayList<>();
            JsonObject p = new JsonObject(); p.addProperty("msg", top != null && !top.isEmpty() ? title + " — " + top : title); p.addProperty("min", min); p.addProperty("max", max);
            p.add("options", options(source, null));
            List<T> out = new ArrayList<>();
            for (int i : idx(ask("choose", p))) if (i >= 0 && i < source.size()) out.add(source.get(i));
            return out;
        }
        @Override public <T> IGuiGame.OrderResult<T> order(String title, String top, int remMin, int remMax, List<T> source, List<T> dest, CardView ref, boolean sideboarding, boolean remember) {
            // ordenar (cartas no topo da biblioteca, gatilhos ao mesmo tempo…): o browser devolve os índices pela ordem
            if (source == null || source.size() <= 1) return new IGuiGame.OrderResult<>(source == null ? new ArrayList<>() : new ArrayList<>(source), false);
            JsonObject p = new JsonObject(); p.addProperty("msg", title); if (top != null) p.addProperty("first", top);
            p.add("options", options(source, null));
            List<Integer> r = idx(ask("order", p));
            List<T> out = new ArrayList<>();
            for (int i : r) if (i >= 0 && i < source.size() && !out.contains(source.get(i))) out.add(source.get(i));
            for (T x : source) if (!out.contains(x)) out.add(x);  // o que ficou por escolher mantém a ordem do Forge
            return new IGuiGame.OrderResult<>(out, false);
        }
        @Override public <T> List<T> insertInList(String title, T item, List<T> list) { List<T> out = new ArrayList<>(list); out.add(0, item); return out; }
        @Override public List<PaperCard> sideboard(CardPool sb, CardPool main, String msg) { return null; }
        @Override public GameEntityView chooseSingleEntityForEffect(String title, List<? extends GameEntityView> opts, DelayedReveal dr, boolean optional) {
            if (opts == null || opts.isEmpty()) return null;
            if (!optional && opts.size() == 1) return opts.get(0);
            JsonObject p = new JsonObject(); p.addProperty("msg", title); p.addProperty("min", optional ? 0 : 1); p.addProperty("max", 1);
            p.add("options", options(new ArrayList<GameEntityView>(opts), null));
            List<Integer> r = idx(ask("choose", p));
            return r.isEmpty() || r.get(0) < 0 || r.get(0) >= opts.size() ? (optional ? null : opts.get(0)) : opts.get(r.get(0));
        }
        @Override public List<GameEntityView> chooseEntitiesForEffect(String title, List<? extends GameEntityView> opts, int min, int max, DelayedReveal dr) {
            JsonObject p = new JsonObject(); p.addProperty("msg", title); p.addProperty("min", min); p.addProperty("max", max);
            p.add("options", options(new ArrayList<GameEntityView>(opts), null));
            List<GameEntityView> out = new ArrayList<>();
            for (int i : idx(ask("choose", p))) if (i >= 0 && i < opts.size()) out.add(opts.get(i));
            return out;
        }
        @Override public List<CardView> manipulateCardList(String title, Iterable<CardView> cards, Iterable<CardView> manipulable, boolean top, boolean bottom, boolean anywhere) {
            List<CardView> out = new ArrayList<>(); for (CardView c : cards) out.add(c); return out;
        }
        @Override public SpellAbilityView getAbilityToPlay(CardView card, List<SpellAbilityView> abilities, ITriggerEvent ev) {
            if (abilities == null || abilities.isEmpty()) return null;
            if (abilities.size() == 1) return abilities.get(0);
            JsonObject p = new JsonObject(); p.addProperty("msg", card.getCurrentState().getName()); p.addProperty("min", 0); p.addProperty("max", 1);
            p.addProperty("card", card.getId()); p.addProperty("cardName", card.getCurrentState().getName()); p.addProperty("ability", true);  // jogar o terreno ou ciclar, as formas de lançar…
            p.add("options", options(abilities, null));
            List<Integer> r = idx(ask("choose", p));
            return r.isEmpty() || r.get(0) < 0 || r.get(0) >= abilities.size() ? null : abilities.get(r.get(0));
        }
        @Override public Map<CardView, Integer> assignCombatDamage(CardView attacker, List<CardView> blockers, int damage, GameEntityView defender, boolean overrideOrder, boolean maySkip) {
            // por agora: letal a cada bloqueador pela ordem, o resto ao último (ou ao defensor com atropelar)
            Map<CardView, Integer> out = new LinkedHashMap<>();
            int left = damage;
            for (int i = 0; i < blockers.size(); i++) {
                CardView b = blockers.get(i);
                int lethal = Math.max(0, b.getCurrentState().getToughness() - b.getDamage());
                int d = i == blockers.size() - 1 && defender == null ? left : Math.min(left, lethal);
                out.put(b, d);
                left -= d;
            }
            if (left > 0 && defender instanceof CardView) out.put((CardView) defender, left);
            else if (left > 0 && !blockers.isEmpty()) out.merge(blockers.get(blockers.size() - 1), left, Integer::sum);
            return out;
        }
        @Override public Map<Object, Integer> assignGenericAmount(CardView source, Map<Object, Integer> targets, int amount, boolean atLeastOne, String label) {
            Map<Object, Integer> out = new LinkedHashMap<>();
            List<Object> ks = new ArrayList<>(targets.keySet());
            int left = amount;
            for (int i = 0; i < ks.size(); i++) { int d = i == ks.size() - 1 ? left : (atLeastOne ? 1 : 0); out.put(ks.get(i), d); left -= d; }
            return out;
        }
        @Override public void updateZones(Iterable<forge.player.PlayerZoneUpdate> u) { dirty = true; }
        @Override public void updateCards(Iterable<CardView> cs) { dirty = true; }
        @Override public void updateLives(Iterable<PlayerView> ps) { dirty = true; }
        @Override public void updateManaPool(Iterable<PlayerView> ps) { dirty = true; }
        @Override public void updatePhase(boolean save) { dirty = true; }
        @Override public void updateTurn(PlayerView p) { dirty = true; }
        @Override public void updateStack() { dirty = true; }
        @Override public void updateRevealedCards(TrackableCollection<CardView> cs) { dirty = true; }
        @Override public void handleGameEvent(forge.game.event.GameEvent ev) { dirty = true; }
    }
}
