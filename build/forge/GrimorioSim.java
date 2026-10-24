// Grimório — lançador próprio do modo "sim" do Forge (forge.view.SimulateMatch, Forge 2.0.15, GPL-3.0).
// Faz o mesmo que `java -jar forge.jar sim …` (mesmos parâmetros: -D -d -n -c -a -f -s -q) com a mesma IA e
// as mesmas regras, mas só OBSERVA o jogo: subscreve o bus de eventos de cada jogo e imprime, em tempo real,
//   - as linhas do registo do Forge à medida que entram (o `sim` original só as imprime no fim do jogo);
//   - linhas "GRIMORIO|…" com o que o registo não diz (compras, mão, mudanças de zona, viradas, marcadores).
// A IA é a do Forge com poucas correções (classe Brain: mulligan, escolha de tipo, Glyph of Life, Supernatural Stamina).
// Formato (campos separados por "|"; o nome da carta é sempre o último campo):
//   GRIMORIO|Z|id|jogadorDe|jogadorPara|deZona|paraZona|ficha(0/1)|P/R|palavras-chave(,)|nome
//       mudança de zona; jogador = 1/2 (dono da zona), 0 = sem zona (ficha criada: deZona vazia)
//   GRIMORIO|H|jogador|biblioteca|id:nome|id:nome…   mão e tamanho da biblioteca no início de cada turno
//   GRIMORIO|T|id|0/1|nome                          carta vira (1) / desvira (0)
//   GRIMORIO|C|id|tipo|antes|depois|nome            marcadores numa carta
//   GRIMORIO|A|id|idAlvo|nome                       anexar (equipamento/aura) a uma carta; idAlvo vazio = solta
//   GRIMORIO|L|jogador|turno|motivo                 jogador eliminado (só com 3+ jogadores: o jogo continua sem ele)
//   Efeitos internos do Forge ("X's Effect", emblemas) não são cartas e ficam de fora.
// Uso: java -cp forge.jar:forge-ext GrimorioSim sim -D dir -d a.dck b.dck -n N -c S -a PerfilA PerfilB [-f Commander]
//      [-S none|hybrid|full none|hybrid|full]   IA com pesquisa de jogadas (forge.ai.simulation), por jogador
//      [-T 1 2 1 2]   equipas (RegisteredPlayer.setTeamNumber); sem -T, todos contra todos. Com 3–4 decks (-d a b c d)
//      o Forge joga em multijogador: elimina um de cada vez e acaba quando sobra um jogador ou uma equipa.
//      [-C 1 0 0 1]  modo casual (formatos misturados): por lugar, 1 = o deck traz o comandante da secção [Commander]
//      (zona de comando, imposto de comandante, voltar à zona de comando, 21 de dano de comandante). No Forge 2.0.15 isto
//      é por jogador (RegisteredPlayer.commanders -> Player.initVariantsZones/createCommanderEffect); só a SBA do
//      cemitério/exílio e a derrota por 21 de dano olham para a variante Commander das regras, que se junta às regras
//      base (-f) quando algum lugar tem comandante. Sem -C fica como antes (-f Commander = todos com comandante).
//      [-L 20 20 40 20]  vida inicial por lugar (as regras base do sim.py: a mesma para todos)
// Os perfis (-a) vêm de res/ai/*.ai; o sim.py monta lá os nossos (build.sh: chances 0/100 -> 10/90).
import java.io.File;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import org.apache.commons.lang3.time.StopWatch;

import com.google.common.eventbus.Subscribe;

import forge.GuiDesktop;
import forge.ai.AIOption;
import forge.ai.AiProfileUtil;
import forge.ai.LobbyPlayerAi;
import forge.ai.ComputerUtil;
import forge.ai.ComputerUtilCard;
import forge.ai.ComputerUtilCombat;
import forge.ai.ComputerUtilCost;
import forge.ai.ComputerUtilMana;
import forge.ai.PlayerControllerAi;
import forge.ai.SpellAbilityAi;
import forge.game.ability.ApiType;
import forge.game.combat.Combat;
import forge.game.phase.PhaseHandler;
import forge.game.phase.PhaseType;
import forge.game.spellability.SpellAbility;
import forge.LobbyPlayer;
import forge.deck.Deck;
import forge.deck.io.DeckSerializer;
import forge.game.*;
import forge.game.card.Card;
import forge.game.card.CardView;
import forge.game.event.*;
import forge.game.keyword.Keyword;
import forge.game.player.Player;
import forge.game.player.PlayerView;
import forge.game.player.RegisteredPlayer;
import forge.game.zone.ZoneType;
import forge.game.zone.ZoneView;
import forge.gui.GuiBase;
import forge.localinstance.properties.ForgeConstants;
import forge.model.FModel;
import forge.player.GamePlayerUtil;
import forge.util.Lang;
import forge.util.MyRandom;
import forge.util.TextUtil;
import forge.util.WordUtil;
import forge.view.TimeLimitedCodeBlock;

public class GrimorioSim {
    public static void main(String[] args) {
        // o mesmo arranque que forge.view.Main faz para "sim", sem o Sentry (relatórios para fora)
        if (System.getProperty("java.awt.headless") == null) System.setProperty("java.awt.headless", "true");
        Thread.setDefaultUncaughtExceptionHandler((t, ex) -> { System.err.println("Uncaught exception in thread " + t.getName() + ":"); ex.printStackTrace(); });
        System.setProperty("java.util.Arrays.useLegacyMergeSort", "true");
        GuiBase.setInterface(new GuiDesktop());
        simulate(args);
        System.out.flush();
        System.exit(0);
    }

    static synchronized void out(String s) {
        System.out.println(s);
        System.out.flush();
    }

    // ---------- igual a SimulateMatch.simulate (sem torneios) ----------
    static void simulate(String[] args) {
        FModel.initialize(null, null);
        System.out.println("Simulation mode");
        final Map<String, List<String>> params = new HashMap<>();
        List<String> options = null;
        for (int i = 1; i < args.length; i++) {
            final String a = args[i];
            if (a.charAt(0) == '-') {
                options = new ArrayList<>();
                params.put(a.substring(1), options);
            } else if (options != null) {
                options.add(a);
            } else {
                System.err.println("Illegal parameter usage");
                return;
            }
        }
        String deckDir = params.containsKey("D") ? params.get("D").get(0) : null;
        int nGames = params.containsKey("n") ? Integer.parseInt(params.get("n").get(0)) : 1;
        boolean outputGamelog = !params.containsKey("q");
        Long seed = null;
        if (params.containsKey("s")) {
            seed = Long.parseLong(params.get("s").get(0));
            MyRandom.setRandom(new Random(seed));
        }
        GameType type = params.containsKey("f") ? GameType.valueOf(WordUtil.capitalize(params.get("f").get(0))) : GameType.Constructed;
        GameRules rules = new GameRules(type);
        rules.setAppliedVariants(EnumSet.of(type));

        List<String> aiProfiles = params.get("a");
        if (aiProfiles != null) {
            for (String profile : aiProfiles) {
                if (!AiProfileUtil.getProfilesDisplayList().contains(profile)) {
                    System.out.println("Unknown AI profile - " + profile + ". Available profiles: " + String.join(", ", AiProfileUtil.getProfilesDisplayList()));
                    return;
                }
            }
        }
        List<String> simModes = params.getOrDefault("S", List.of());
        List<String> teams = params.getOrDefault("T", List.of());
        List<String> cmdSeats = params.getOrDefault("C", List.of()), lifes = params.getOrDefault("L", List.of());
        if (cmdSeats.contains("1") && !rules.hasAppliedVariant(GameType.Commander)) rules.addAppliedVariant(GameType.Commander);
        List<RegisteredPlayer> pp = new ArrayList<>();
        StringBuilder sb = new StringBuilder();
        int i = 1;
        for (String deck : params.getOrDefault("d", List.of())) {
            Deck d = deckFrom(deck, type, deckDir);
            if (d == null) {
                System.out.println(TextUtil.concatNoSpace("Could not load deck - ", deck, ", match cannot start"));
                return;
            }
            if (i > 1) sb.append(" vs ");
            String profile = aiProfiles != null && aiProfiles.size() >= i ? aiProfiles.get(i - 1) : "";
            String name = TextUtil.concatNoSpace("Ai(", String.valueOf(i), ")-", d.getName());
            sb.append(name);
            if (!profile.isEmpty()) sb.append(" [").append(profile).append("]");
            RegisteredPlayer rp = type.equals(GameType.Commander) && cmdSeats.isEmpty() ? RegisteredPlayer.forCommander(d) : new RegisteredPlayer(d);
            if (cmdSeats.size() >= i && cmdSeats.get(i - 1).equals("1")) rp.assignCommander();
            if (lifes.size() >= i) rp.setStartingLife(Integer.parseInt(lifes.get(i - 1)));
            // = GamePlayerUtil.createAiPlayer(name, i - 1, profile) (mesma capa ao acaso), mais a pesquisa de jogadas
            String sim = simModes.size() >= i ? simModes.get(i - 1) : "none";
            Set<AIOption> opts = sim.equals("full") ? EnumSet.of(AIOption.USE_FULL_SIMULATION)
                    : sim.equals("hybrid") ? EnumSet.of(AIOption.USE_HYBRID_SIMULATION) : null;
            int sleeves = GuiBase.getInterface().getSleevesCount();
            int sleeve = sleeves == 0 ? 0 : MyRandom.getRandom().nextInt(sleeves);
            rp.setPlayer(withBrain((LobbyPlayerAi) GamePlayerUtil.createAiPlayer(name, i - 1, sleeve, opts, profile), opts));
            if (teams.size() >= i) rp.setTeamNumber(Integer.parseInt(teams.get(i - 1)));
            pp.add(rp);
            i++;
        }
        if (params.containsKey("c")) rules.setSimTimeout(Integer.parseInt(params.get("c").get(0)));
        sb.append(" - ").append(Lang.nounWithNumeral(nGames, "game")).append(" of ").append(type);
        if (seed != null) sb.append(" seed ").append(seed);
        out(sb.toString());

        Match mc = new Match(rules, pp, "Test");
        for (int iGame = 0; iGame < nGames; iGame++) simulateSingleMatch(mc, iGame, outputGamelog);
    }

    // A IA de cada lugar é a do Forge (mesmo perfil, capa e pesquisa de jogadas) com o controlador Brain por cima.
    static LobbyPlayerAi withBrain(LobbyPlayerAi base, Set<AIOption> opts) {
        AIOption opt = opts == null || opts.isEmpty() ? null : opts.iterator().next();
        LobbyPlayerAi lp = new LobbyPlayerAi(base.getName(), opts) {
            @Override
            public Player createIngamePlayer(Game game, int id) {
                Player p = new Player(getName(), game, id);
                Brain c = new Brain(game, p, this);
                c.getAi().setUseSimulation(opt);
                p.setFirstController(c);
                return p;
            }
        };
        lp.setAiProfile(base.getAiProfile());
        lp.setAvatarIndex(base.getAvatarIndex());
        lp.setSleeveIndex(base.getSleeveIndex());
        return lp;
    }

    // Correções à IA do Forge 2.0.15 que os guiões das cartas (build/forge/cards) não conseguem exprimir: a IA decide
    // pela API da habilidade de topo e não há lógica para «a minha Wall está a bloquear» nem «vai morrer, volta».
    static class Brain extends PlayerControllerAi {
        final Set<String> tried = new HashSet<>();  // uma tentativa por carta e passo: um custo que falhe não faz ciclo

        Brain(Game game, Player p, LobbyPlayer lp) { super(game, p, lp); }

        // Mulligan: no London a mão já vem sem as cartas postas no fundo, mas o ComputerUtil.scoreHand desconta-as
        // outra vez (5 na mão − 2 = «ficaria com 3», abaixo do MULLIGAN_THRESHOLD) e a IA ficava com qualquer mão de
        // 5, mesmo sem terrenos. Aqui a mão que fica é avaliada como está, pelas regras do Forge (com 5 cartas e menos
        // de 2 terrenos volta; com 4 fica se tiver terreno); e com 5 ou mais cartas, sem terrenos ou só terrenos volta
        // sempre (o Forge deixava passar decks com muito poucos ou muitíssimos terrenos).
        @Override
        public boolean mulliganKeepHand(Player first, int tuck) {
            int n = 0, lands = 0, libLands = 0;
            for (Card c : player.getCardsIn(ZoneType.Hand)) { n++; if (c.isLand()) lands++; }
            for (Card c : player.getCardsIn(ZoneType.Library)) if (c.isLand()) libLands++;
            boolean keep = tuck == 0 ? super.mulliganKeepHand(first, 0) : !ComputerUtil.wantMulligan(player, 0);
            return keep && !(n >= 5 && libLands > 0 && (lands == 0 || lands == n));
        }

        // «Escolhe criatura ou terreno» (Winding Way…): o Forge escolhe ao acaso; aqui, o tipo com mais cartas na
        // biblioteca; com menos de 3 terrenos em jogo e na mão, terrenos já se valerem metade das criaturas.
        @Override
        public String chooseSomeType(String kind, SpellAbility sa, Collection<String> valid, boolean optional) {
            if (!"Card".equals(kind) || valid == null || !valid.contains("Creature") || !valid.contains("Land"))
                return super.chooseSomeType(kind, sa, valid, optional);
            int cr = 0, ld = 0, have = 0;
            for (Card c : player.getCardsIn(ZoneType.Library)) { if (c.isCreature()) cr++; if (c.isLand()) ld++; }
            for (Card c : player.getCardsIn(ZoneType.Battlefield, ZoneType.Hand)) if (c.isLand()) have++;
            return ld > cr || (have < 3 && ld > 0 && 2 * ld >= cr) ? "Land" : "Creature";
        }

        @Override
        public List<SpellAbility> chooseSpellAbilityToPlay() {
            SpellAbility sa = hint();
            if (sa != null) return List.of(sa);
            List<SpellAbility> r = super.chooseSpellAbilityToPlay();
            if (r != null && !r.isEmpty()) return r;
            sa = cantrip();
            return sa != null ? List.of(sa) : r;
        }

        // Compra/seleção barata (Consider, Opt, Preordain, Faithless Looting, Thought Scour, Ancient Stirrings…) com a
        // mana que ia ficar parada. O Forge decide ao acaso (ScryAi/SurveilAi: 40% a instantâneo, 67% a feitiço, só no
        // Main 1), o DrawAi deixa os instantâneos só para o fim do turno do adversário e com mais de uma carta na mão, e
        // cartas «AI:RemoveDeck:All» (Faithless Looting, Gitaxian Probe) nunca entram na lista. Aqui, só quando a IA do
        // Forge já passou (não substitui nenhuma jogada dela):
        //   - instantâneos no fim do turno do adversário que antecede o nosso (a mana desvira a seguir);
        //   - feitiços no Main 2 do nosso turno; no Main 1 (feitiços e instantâneos) só se ainda não houve terreno e não
        //     há nenhum na mão (procura-o), e sem tirar mana às outras cartas que dá para lançar;
        //   - no nosso turno guarda mana para a resposta instantânea mais cara que tem na mão (contrafeitiço, remoção,
        //     truque) se a puder pagar agora; se a mana não chega para as duas, não lança.
        // Só cartas cujo efeito é todo comprar/olhar/descartar/moer (sem alvos que não sejam jogadores) e só com custo de
        // mana (Village Rites, Thrill of Possibility, Deadly Dispute ficam com a IA do Forge).
        static final EnumSet<ApiType> SELECT = EnumSet.of(ApiType.Draw, ApiType.Scry, ApiType.Surveil, ApiType.Dig, ApiType.DigUntil);
        static final EnumSet<ApiType> SAFE = EnumSet.of(ApiType.Draw, ApiType.Scry, ApiType.Surveil, ApiType.Dig, ApiType.DigUntil,
                ApiType.Discard, ApiType.Mill, ApiType.ChangeZone, ApiType.LoseLife, ApiType.GainLife, ApiType.PumpAll, ApiType.RevealHand);

        SpellAbility cantrip() {
            Game g = player.getGame();
            PhaseHandler ph = g.getPhaseHandler();
            if (!g.getStack().isEmpty() || player.getCardsIn(ZoneType.Library).size() < 5) return null;
            boolean mine = ph.isPlayerTurn(player);
            boolean eot = !mine && ph.is(PhaseType.END_OF_TURN) && ph.getNextTurn() == player;
            boolean main2 = mine && ph.is(PhaseType.MAIN2);
            boolean dig = mine && ph.is(PhaseType.MAIN1) && player.getLandsPlayedThisTurn() == 0
                    && player.getCardsIn(ZoneType.Hand).stream().noneMatch(Card::isLand);
            if (!eot && !main2 && !dig) return null;
            List<Card> hand = new ArrayList<>(player.getCardsIn(ZoneType.Hand));
            hand.sort(Comparator.comparingInt(Card::getCMC));
            for (Card c : hand) {
                SpellAbility sa = c.getFirstSpellAbility();
                if (sa == null || !selects(sa) || c.getCMC() > 4) continue;
                boolean instant = !SpellAbilityAi.isSorcerySpeed(sa, player);
                if (eot != instant && !dig) continue;  // instantâneos só no fim do turno do adversário (ou à procura de terreno)
                if (sa.findSubAbilityByType(ApiType.Discard) != null && hand.size() < 2) continue;  // descartava o que comprou
                if (sa.findSubAbilityByType(ApiType.LoseLife) != null && player.getLife() <= 6) continue;
                if (!tried.add(ph.getTurn() + ":" + ph.getPhase() + ":" + c.getId() + ":cantrip")) continue;
                sa.setActivatingPlayer(player);
                if (!targetPlayers(sa) || !sa.canPlay() || !ComputerUtilCost.canPayCost(sa, player, false)) { sa.resetTargets(); continue; }
                // a mana que fica tem de chegar para a carta mais cara que dá para pagar agora: no Main 2 as respostas
                // instantâneas; no Main 1 tudo (a IA do Forge pode estar a guardar mana para lançar criaturas no Main 2)
                int keep = 0;
                if (!eot) for (Card o : hand) {
                    SpellAbility os = o == c || o.isLand() ? null : o.getFirstSpellAbility();
                    if (os == null || selects(os) || (!dig && SpellAbilityAi.isSorcerySpeed(os, player))) continue;
                    os.setActivatingPlayer(player);
                    // truque ou remoção sem alvo em jogo não é resposta (contrafeitiços têm alvo só na pilha: contam)
                    if (os.usesTargeting() && os.getApi() != ApiType.Counter && os.getTargetRestrictions().getNumCandidates(os) == 0) continue;
                    int need = o.getCMC() - o.getManaCost().getPhyrexianCount();  // mana phyrexiana paga-se com vida
                    if (need > keep && ComputerUtilMana.canPayManaCost(os, player, 0, false)) keep = need;
                }
                if (keep > 0 && !ComputerUtilMana.canPayManaCost(sa, player, keep, false)) { sa.resetTargets(); continue; }
                return sa;
            }
            return null;
        }

        static boolean selects(SpellAbility sa) {
            if (sa.getApi() == null || !sa.isSpell() || sa.getPayCosts() == null || !sa.getPayCosts().isOnlyManaCost()) return false;
            boolean sel = false;
            for (SpellAbility s = sa; s != null; s = s.getSubAbility()) {
                if (s.getApi() == null || !SAFE.contains(s.getApi())) return false;
                if (s.usesTargeting() && !s.getTargetRestrictions().canTgtPlayer()) return false;
                if (s.getApi() == ApiType.ChangeZone && !"Hand".equals(s.getParam("Origin"))) return false;  // Brainstorm
                if (s.getApi() == ApiType.PumpAll && !String.valueOf(s.getParam("ValidCards")).contains("YouCtrl")) return false;
                sel |= SELECT.contains(s.getApi());
            }
            return sel;
        }

        // alvos jogador: o próprio (Sign in Blood, Thought Scour); a revelação da mão vai para um adversário (Gitaxian Probe)
        boolean targetPlayers(SpellAbility sa) {
            sa.resetTargets();
            for (SpellAbility s = sa; s != null; s = s.getSubAbility()) {
                if (!s.usesTargeting()) continue;
                s.resetTargets();
                Player t = s.getApi() == ApiType.RevealHand || s.getTargetRestrictions().canOnlyTgtOpponent()
                        ? player.getOpponents().stream().filter(s::canTarget).findFirst().orElse(null)
                        : s.canTarget(player) ? player : null;
                if (t == null) return false;
                s.getTargets().add(t);
            }
            return true;
        }

        SpellAbility hint() {
            Game g = player.getGame();
            PhaseHandler ph = g.getPhaseHandler();
            Combat cb = g.getCombat();
            boolean blocks = cb != null && ph.is(PhaseType.COMBAT_DECLARE_BLOCKERS) && g.getStack().isEmpty();
            for (Card c : player.getCardsIn(ZoneType.Hand)) {
                Card t = null;
                if (c.getName().equals("Glyph of Life") && blocks && ph.getPlayerTurn().isOpponentOf(player)) {
                    // a Wall que bloqueia mais poder (ganha-se a vida do dano que leva); só a partir de 2
                    int best = 1;
                    for (Card w : player.getCreaturesInPlay()) {
                        if (!w.getType().hasCreatureType("Wall") || !cb.isBlocking(w)) continue;
                        int d = 0;
                        for (Card a : cb.getAttackersBlockedBy(w)) d += Math.max(0, a.getNetCombatDamage());
                        if (d > best) { best = d; t = w; }
                    }
                } else if (c.getName().equals("Supernatural Stamina")) {
                    // volta ao campo quando morre: em resposta a remoção que manda para o cemitério, ou no combate
                    // quando a criatura (não ficha) vai morrer; a melhor das ameaçadas
                    List<Card> mine = new ArrayList<>();
                    if (!g.getStack().isEmpty() && g.getStack().peekAbility().getActivatingPlayer().isOpponentOf(player)) {
                        ApiType api = g.getStack().peekAbility().getApi();
                        if (api == ApiType.Destroy || api == ApiType.DestroyAll || api == ApiType.DealDamage
                                || api == ApiType.DamageAll || api == ApiType.Pump || api == ApiType.PumpAll)
                            for (GameObject o : ComputerUtil.predictThreatenedObjects(player, null, true))
                                if (o instanceof Card x && x.getController() == player) mine.add(x);
                    } else if (blocks) {
                        for (Card x : player.getCreaturesInPlay())
                            if ((cb.isBlocking(x) || cb.isBlocked(x)) && ComputerUtilCombat.combatantWouldBeDestroyed(player, x, cb)) mine.add(x);
                    }
                    int best = -1;
                    for (Card x : mine) {
                        if (x.isToken() || !x.isCreature()) continue;
                        int v = ComputerUtilCard.evaluateCreature(x);
                        if (v > best) { best = v; t = x; }
                    }
                }
                if (t == null || !tried.add(ph.getTurn() + ":" + ph.getPhase() + ":" + c.getId() + ":" + g.getStack().size())) continue;
                SpellAbility sa = c.getFirstSpellAbility();
                if (sa == null) continue;
                sa.setActivatingPlayer(player);
                sa.resetTargets();
                if (!sa.canTarget(t)) continue;
                sa.getTargets().add(t);
                if (sa.canPlay() && ComputerUtilCost.canPayCost(sa, player, false)) return sa;
                sa.resetTargets();
            }
            return null;
        }
    }

    static Deck deckFrom(String deckname, GameType type, String deckDir) {
        String baseDir = deckDir != null ? deckDir : (type.equals(GameType.Commander) ? ForgeConstants.DECK_COMMANDER_DIR : ForgeConstants.DECK_CONSTRUCTED_DIR);
        if (!baseDir.endsWith(File.separator)) baseDir += File.separator;
        File f = new File(baseDir + deckname);
        if (!f.exists()) System.out.println("No deck found in " + baseDir);
        return DeckSerializer.fromFile(f);
    }

    // ---------- igual a SimulateMatch.simulateSingleMatch + o espião ----------
    static void simulateSingleMatch(final Match mc, int iGame, boolean outputGamelog) {
        final StopWatch sw = new StopWatch();
        sw.start();
        final Game g1 = mc.createGame();
        g1.setNoGUIUser();
        final Spy spy = new Spy(g1, outputGamelog);
        g1.subscribeToEvents(spy);
        g1.getGameLog().addObserver((o, arg) -> spy.log());
        try {
            TimeLimitedCodeBlock.runWithTimeout(() -> {
                mc.startGame(g1);
                sw.stop();
            }, mc.getRules().getSimTimeout(), TimeUnit.SECONDS);
        } catch (TimeoutException e) {
            out("Stopping slow match as draw");
        } catch (Exception | StackOverflowError e) {
            e.printStackTrace();
        } finally {
            if (sw.isStarted()) sw.stop();
            g1.setGameOver(GameEndReason.Draw);
        }
        spy.log();
        spy.on = false;  // um jogo parado por tempo pode continuar numa thread: não mistura linhas no jogo seguinte
        if (!outputGamelog) {
            List<GameLogEntry> log = g1.getGameLog().getLogEntries(GameLogEntryType.MATCH_RESULTS);
            Collections.reverse(log);
            for (GameLogEntry l : log) out(String.valueOf(l));
        }
        // parado por tempo: o Forge dá a vitória a todos os que ainda jogam (onGameOver) e isDraw() fica falso
        if (g1.getOutcome().isDraw() || g1.getOutcome().getWinCondition() == GameEndReason.Draw) {
            out(String.format("%nGame Result: Game %d ended in a Draw! Took %d ms.", 1 + iGame, sw.getTime()));
        } else {
            out(String.format("%nGame Result: Game %d ended in %d ms. %s has won!%n", 1 + iGame, sw.getTime(), g1.getOutcome().getWinningLobbyPlayer().getName()));
        }
    }

    // ---------- o espião: só lê, nunca altera o jogo ----------
    public static class Spy {
        static final Keyword[] KW = {Keyword.FLYING, Keyword.FIRST_STRIKE, Keyword.DOUBLE_STRIKE, Keyword.DEATHTOUCH, Keyword.LIFELINK,
                Keyword.TRAMPLE, Keyword.VIGILANCE, Keyword.HASTE, Keyword.HEXPROOF, Keyword.INDESTRUCTIBLE, Keyword.MENACE,
                Keyword.REACH, Keyword.INFECT};
        final Game g;
        final boolean logLive;
        final Map<Integer, Integer> seat = new HashMap<>();
        volatile boolean on = true;
        int printed = 0;

        Spy(Game g, boolean logLive) {
            this.g = g;
            this.logLive = logLive;
            int i = 1;
            for (Player p : g.getPlayers()) seat.put(p.getId(), i++);
        }

        int seat(PlayerView p) { return p == null ? 0 : seat.getOrDefault(p.getId(), 0); }

        static String name(CardView c) { return c == null || c.getName() == null ? "" : c.getName().replace('|', '/').replace('\n', ' '); }

        void emit(String s) { if (on) out("GRIMORIO|" + s); }

        // registo do Forge em tempo real (as mesmas linhas que o `sim` imprime no fim, pela mesma ordem)
        synchronized void log() {
            if (!on || !logLive) return;
            List<GameLogEntry> all = g.getGameLog().getAllEntries();
            for (; printed < all.size(); printed++) out(String.valueOf(all.get(printed)));
        }

        static boolean fake(CardView c) { return c == null || c.isImmutable() || c.isEmblem(); }

        @Subscribe
        public void zone(GameEventCardChangeZone e) {
            CardView c = e.card();
            if (fake(c)) return;
            ZoneView f = e.from(), t = e.to();
            String pt = "", kw = "";
            if (c.isToken() && c.getCurrentState() != null) {
                CardView.CardStateView st = c.getCurrentState();
                if (st.getType() != null && st.getType().isCreature()) pt = st.getPower() + "/" + st.getToughness();
                List<String> ks = new ArrayList<>();
                for (Keyword k : KW) if (st.hasKeyword(k)) ks.add(k.toString());
                kw = String.join(",", ks);
            }
            emit("Z|" + c.getId() + "|" + (f == null ? 0 : seat(f.player())) + "|" + (t == null ? 0 : seat(t.player())) + "|"
                    + (f == null ? "" : f.zoneType()) + "|" + (t == null ? "" : t.zoneType()) + "|" + (c.isToken() ? 1 : 0) + "|"
                    + pt + "|" + kw + "|" + name(c));
        }

        // eliminações em multijogador: o Forge não tem evento próprio; cada evento do bus vê se alguém saiu do jogo
        final Set<Integer> lost = new HashSet<>();

        @Subscribe
        public void any(GameEvent e) {
            if (seat.size() < 3) return;
            for (Player p : g.getLostPlayers())
                if (lost.add(p.getId()))
                    emit("L|" + seat.get(p.getId()) + "|" + g.getPhaseHandler().getTurn() + "|" + String.valueOf(p.getOutcome()).replace('|', '/'));
        }

        @Subscribe
        public void turn(GameEventTurnBegan e) {
            for (Player p : g.getPlayers()) {
                StringBuilder sb = new StringBuilder("H|" + seat.get(p.getId()) + "|" + p.getCardsIn(ZoneType.Library).size());
                for (Card c : p.getCardsIn(ZoneType.Hand)) sb.append('|').append(c.getId()).append(':').append(name(c.getView()));
                emit(sb.toString());
            }
        }

        @Subscribe
        public void tapped(GameEventCardTapped e) {
            if (fake(e.card())) return;
            emit("T|" + e.card().getId() + "|" + (e.tapped() ? 1 : 0) + "|" + name(e.card()));
        }

        @Subscribe
        public void counters(GameEventCardCounters e) {
            if (fake(e.card())) return;
            emit("C|" + e.card().getId() + "|" + e.type().getName() + "|" + e.oldValue() + "|" + e.newValue() + "|" + name(e.card()));
        }

        @Subscribe
        public void attach(GameEventCardAttachment e) {
            String to = e.newTarget() instanceof CardView ? String.valueOf(e.newTarget().getId()) : "";
            emit("A|" + e.equipment().getId() + "|" + to + "|" + name(e.equipment()));
        }
    }
}
