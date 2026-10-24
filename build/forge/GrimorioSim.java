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
import forge.ai.AiCostDecision;
import forge.card.ColorSet;
import forge.game.cost.Cost;
import forge.game.cost.CostPart;
import forge.game.cost.CostPayLife;
import forge.game.cost.CostPayment;
import forge.game.cost.CostPartMana;
import forge.game.cost.CostSacrifice;
import forge.game.ability.AbilityUtils;
import forge.game.card.CardCollection;
import forge.game.card.CardCollectionView;
import forge.game.card.CardLists;
import forge.game.card.CardPredicates;
import forge.game.card.CounterEnumType;
import forge.ai.ability.TokenAi;
import forge.game.player.DelayedReveal;
import forge.util.collect.FCollectionView;
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
            if (sa == null) sa = counter();
            if (sa == null) sa = reanimate(false);
            if (sa == null) sa = entomb();
            if (sa == null) sa = disrupt();
            if (sa == null) sa = sacOutlet();
            if (sa != null) return List.of(sa);
            List<SpellAbility> held = holdBack(), r;
            try { r = super.chooseSpellAbilityToPlay(); } finally { for (SpellAbility h : held) h.removeParam("AILifeThreshold"); }
            if (r != null && !r.isEmpty()) {
                // o CounterAi contraria ao acaso pelo custo (30% a custo 1, 75% a custo 2): com o último contrafeitiço na
                // mão não o gasta no que não vale (fica para a ameaça seguinte)
                SpellAbility f = r.get(0), t = f.getApi() == ApiType.Counter ? f.getTargets().getFirstTargetedSpell() : null;
                if (t != null && t.getActivatingPlayer().isOpponentOf(player) && !worth(t) && counters() <= 1) return null;
                return r;
            }
            sa = cantrip();
            if (sa == null) sa = reanimate(true);
            if (sa == null) sa = construct();
            return sa != null ? List.of(sa) : r;
        }

        // Fetchlands (Polluted Delta, Flooded Strand…): para «Island ou Swamp» o Forge traz o tipo básico com menos cópias
        // na biblioteca (ComputerUtilCard.getBestLandAI) sem olhar à mão — com 6 Islands, 2 Swamps e dois Counterspell na
        // mão ia buscar o Swamp. Aqui traz-se o terreno da cor que falta à mão: por cor, os símbolos que a carta mais
        // exigente da mão pede menos as fontes dessa cor já em jogo. Sem nada em falta, ou empate entre cores, decide o Forge.
        static final String[] BASIC = {"Plains", "Island", "Swamp", "Mountain", "Forest"}, COLOR = {"W", "U", "B", "R", "G"};

        @Override
        public Card chooseSingleCardForZoneChange(ZoneType destination, List<ZoneType> origin, SpellAbility sa, CardCollection fetchList,
                DelayedReveal delayedReveal, String selectPrompt, boolean isOptional, Player decider) {
            Card c = decider == player && origin.contains(ZoneType.Library) && fetchList != null && fetchList.size() > 1
                    && fetchList.stream().allMatch(Card::isLand) ? landForHand(fetchList) : null;
            if (c == null && decider == player && destination == ZoneType.Graveyard && origin.contains(ZoneType.Library) && fetchList != null && reanimator()) {
                // Unmarked Grave/Entomb num deck que reanima: a melhor criatura grande (custo 5+, lendária só se dá para a reanimar); as que têm
                // gatilhos (ao entrar/atacar: Archon of Cruelty, Agent of Treachery) antes das só grandes (Serra's Emissary)
                int bv = -1;
                for (Card x : fetchList) {
                    if (!bigOk(x)) continue;
                    int v = ComputerUtilCard.evaluateCreature(x) + (x.getTriggers().isEmpty() ? 0 : 1000);
                    if (v > bv) { bv = v; c = x; }
                }
            }
            if (c == null) return super.chooseSingleCardForZoneChange(destination, origin, sa, fetchList, delayedReveal, selectPrompt, isOptional, decider);
            if (delayedReveal != null) reveal(delayedReveal);
            return c;
        }

        Card landForHand(List<Card> list) {
            int[] need = new int[5], have = new int[5];
            for (Card h : player.getCardsIn(ZoneType.Hand)) {
                if (h.isLand()) continue;
                int[] k = h.getManaCost().getColorShardCounts();  // WUBRGC
                for (int i = 0; i < 5; i++) need[i] = Math.max(need[i], k[i]);
            }
            for (Card l : player.getCardsIn(ZoneType.Battlefield)) {
                if (!l.isLand()) continue;
                for (int i = 0; i < 5; i++)
                    for (SpellAbility m : l.getManaAbilities()) if (m.canProduce(COLOR[i])) { have[i]++; break; }
            }
            Card best = null;
            String bestKey = null;
            int bs = 0;
            boolean tie = false;
            for (Card c : list) {
                int sc = 0;
                StringBuilder key = new StringBuilder();
                for (int i = 0; i < 5; i++) if (c.getType().hasSubtype(BASIC[i])) { sc += Math.max(0, need[i] - have[i]); key.append(COLOR[i]); }
                if (sc > bs) { bs = sc; best = c; bestKey = key.toString(); tie = false; }
                else if (sc == bs && sc > 0 && !key.toString().equals(bestKey)) tie = true;
            }
            return tie ? null : best;
        }

        // Contrafeitiços: o CounterAi do Forge decide por sorte pelo custo do feitiço (CHANCE_TO_COUNTER_CMC_1/2 = 30/75%)
        // e não olha ao que o feitiço faz. Aqui contraria-se sempre o que vale a carta — criatura ou planeswalker de custo
        // 2+, qualquer feitiço de custo 3+, remoção/dano/descarte/roubo apontado a nós ou ao que é nosso, limpeza de mesa
        // com criaturas nossas em jogo, truque de combate durante o combate, contrafeitiço contra o nosso — e o resto fica
        // com o Forge (que com um só contrafeitiço na mão já não o gasta, ver chooseSpellAbilityToPlay). Só contrafeitiços
        // de custo em mana sem «a não ser que pague» (Mana Leak e afins ficam com o Forge, que conta a mana do adversário).
        SpellAbility counter() {
            Game g = player.getGame();
            // o feitiço do adversário mais acima na pilha (por cima dele podem estar gatilhos: prowess, Dragon's Rage Channeler…)
            SpellAbility top = null;
            for (forge.game.spellability.SpellAbilityStackInstance si : g.getStack()) {
                SpellAbility x = si.getSpellAbility();
                if (x != null && x.isSpell()) { top = x; break; }
            }
            if (top == null || !top.getActivatingPlayer().isOpponentOf(player) || !worth(top)) return null;
            for (Card c : player.getCardsIn(ZoneType.Hand)) {
                SpellAbility sa = c.getFirstSpellAbility();
                if (sa == null || sa.getApi() != ApiType.Counter || !sa.usesTargeting() || sa.hasParam("UnlessCost")
                        || sa.getPayCosts() == null || !sa.getPayCosts().isOnlyManaCost()) continue;
                if (!tried.add("counter:" + top.getId() + ":" + c.getId())) continue;
                sa.setActivatingPlayer(player);
                sa.resetTargets();
                if (!top.isCounterableBy(sa) || !sa.canTargetSpellAbility(top) || !sa.canPlay() || !ComputerUtilCost.canPayCost(sa, player, false)) continue;
                sa.getTargets().add(top);
                return sa;
            }
            return null;
        }

        int counters() {
            int n = 0;
            for (Card c : player.getCardsIn(ZoneType.Hand)) {
                SpellAbility sa = c.getFirstSpellAbility();
                if (sa != null && sa.getApi() == ApiType.Counter) n++;
            }
            return n;
        }

        static final EnumSet<ApiType> HARM = EnumSet.of(ApiType.Destroy, ApiType.DealDamage, ApiType.LoseLife, ApiType.Discard, ApiType.Sacrifice,
                ApiType.ChangeZone, ApiType.GainControl, ApiType.Counter, ApiType.Tap, ApiType.Attach, ApiType.Pump, ApiType.Mill);
        static final EnumSet<ApiType> WIPE = EnumSet.of(ApiType.DestroyAll, ApiType.DamageAll, ApiType.SacrificeAll, ApiType.ChangeZoneAll, ApiType.PumpAll);

        boolean worth(SpellAbility top) {
            Card src = top.getHostCard();
            int cmc = src == null ? 0 : src.getCMC();
            if (cmc >= 3 || (src != null && (src.isCreature() || src.isPlaneswalker()) && cmc >= 2)) return true;
            boolean board = !player.getCreaturesInPlay().isEmpty();
            for (SpellAbility s = top; s != null; s = s.getSubAbility()) {
                ApiType a = s.getApi();
                if (a == null) continue;
                if (WIPE.contains(a) && board) return true;
                if ((a == ApiType.Pump || a == ApiType.PumpAll) && player.getGame().getCombat() != null) return true;  // truque no combate
                if (!HARM.contains(a)) continue;
                for (Player p : s.getTargets().getTargetPlayers()) if (p == player && a != ApiType.Pump && a != ApiType.Attach) return true;
                for (Card x : s.getTargets().getTargetCards()) if (x.getController() == player && a != ApiType.Pump) return true;
                for (SpellAbility x : s.getTargets().getTargetSpells()) if (x.getActivatingPlayer() == player) return true;  // contrafeitiço contra o nosso
            }
            return false;
        }

        // Descarte com escolha (Thoughtseize, Inquisition of Kozilek, Duress…): o DiscardAi só o deixa no Main 2 e, até lá,
        // a IA gasta a mana em criaturas; num registo de 24 jogos ficou na mão em 17 turnos com mana e cartas boas na
        // mão do adversário. Como um jogador faria: no nosso turno, depois do terreno, é a primeira coisa a lançar, se o
        // adversário tem uma carta que se pode escolher e a vida chega para o custo (fica com 6+).
        SpellAbility disrupt() {
            Game g = player.getGame();
            PhaseHandler ph = g.getPhaseHandler();
            if (!g.getStack().isEmpty() || !ph.isPlayerTurn(player) || !ph.getPhase().isMain()) return null;
            List<Card> hand = new ArrayList<>(player.getCardsIn(ZoneType.Hand));
            if (ph.is(PhaseType.MAIN1) && player.getLandsPlayedThisTurn() == 0 && hand.stream().anyMatch(Card::isLand)) return null;  // o terreno primeiro
            for (Card c : hand) {
                SpellAbility sa = c.getFirstSpellAbility();
                if (sa == null || sa.getApi() != ApiType.Discard || !sa.isSpell() || !sa.usesTargeting() || sa.getPayCosts() == null
                        || !sa.getPayCosts().isOnlyManaCost() || !String.valueOf(sa.getParam("Mode")).contains("YouChoose")) continue;
                if (sa.findSubAbilityByType(ApiType.LoseLife) != null && player.getLife() < 8) continue;
                if (!tried.add(ph.getTurn() + ":" + ph.getPhase() + ":" + c.getId() + ":disrupt")) continue;
                sa.setActivatingPlayer(player);
                sa.resetTargets();
                String[] valid = sa.hasParam("DiscardValid") ? sa.getParam("DiscardValid").split(",") : null;
                Player t = null;
                int most = 0;
                // reanimador com a grande presa na mão, o feitiço de reanimar na mão e nada no cemitério nem maneira de lá
                // pôr nada: o descarte vai para nós (a escolha é chooseCardsToDiscardFrom → a grande)
                if (reanimatesIn(hand) && !gyTarget() && hand.stream().noneMatch(h -> entombs(h.getFirstSpellAbility())) && player.getLife() >= 10
                        && sa.canTarget(player) && hand.stream().anyMatch(h -> fat(h) && (valid == null || h.isValid(valid, player, c, sa)))) {
                    t = player;
                    most = Integer.MAX_VALUE;
                }
                for (Player o : player.getOpponents()) {
                    if (t == player || !sa.canTarget(o) || !o.canDiscardBy(sa, true)) continue;
                    int n = 0;
                    for (Card x : o.getCardsIn(ZoneType.Hand)) if (valid == null || x.isValid(valid, player, c, sa)) n++;
                    if (n > most) { most = n; t = o; }
                }
                if (t == null || !sa.canPlay() || !ComputerUtilCost.canPayCost(sa, player, false)) continue;
                int keep = reserve(hand, c, false);
                if (keep > 0 && !ComputerUtilMana.canPayManaCost(sa, player, keep, false)) continue;
                sa.getTargets().add(t);
                return sa;
            }
            return null;
        }

        // Terrenos de choque (Blood Crypt, Godless Shrine…: «paga 2 de vida ou entra virado»). O TapAi só paga quando uma
        // carta da mão com custo igual ao nº de terrenos passa no canPlaySa, mas esse já exige a mana paga sem o terreno
        // que está a entrar (e o DiscardAi recusa tudo antes do Main 2): na prática entravam sempre virados (0 de 17
        // num registo de torneio) e o Thoughtseize do 1.º turno ou o 2-drop do 2.º ficavam na mão. Aqui, no nosso turno,
        // paga-se quando há na mão uma carta que só dá para lançar com a mana deste terreno e a vida chega (fica com 5+).
        @Override
        public boolean payCostToPreventEffect(Cost cost, SpellAbility sa, boolean alreadyPaid, FCollectionView<Player> allPayers) {
            List<CostPart> parts = cost.getCostParts();
            if (alreadyPaid || sa.getApi() != ApiType.Tap || !sa.hasParam("ETB") || parts.size() != 1 || !(parts.get(0) instanceof CostPayLife pl))
                return super.payCostToPreventEffect(cost, sa, alreadyPaid, allPayers);
            Integer n = pl.convertAmount();
            if (n == null || !shockPays(sa.getHostCard(), n, sa) || !ComputerUtilCost.canPayCost(cost, sa, player, true)) return false;
            return new CostPayment(cost, sa).payComputerCosts(new AiCostDecision(player, sa, true));
        }

        boolean shockPays(Card land, int life, SpellAbility sa) {
            PhaseHandler ph = player.getGame().getPhaseHandler();
            if (!ph.isPlayerTurn(player) || !ph.getPhase().isMain() || player.getLife() - life < 5 || !player.canPayLife(life, true, sa)) return false;
            int untapped = 0;
            for (Card c : player.getCardsIn(ZoneType.Battlefield))
                if (c != land && c.isLand() && c.isUntapped() && !c.getManaAbilities().isEmpty()) untapped++;
            byte colors = ColorSet.fromNames(ComputerUtilCost.getAvailableManaColors(player, land)).getColor();
            for (Card c : player.getCardsIn(ZoneType.Hand)) {
                SpellAbility s = c.isLand() ? null : c.getFirstSpellAbility();
                int cmc = c.getCMC() - c.getManaCost().getPhyrexianCount();
                if (s == null || cmc < 1 || cmc > untapped + 1 || !c.getManaCost().canBePaidWithAvailable(colors)) continue;
                s.setActivatingPlayer(player);
                if (s.usesTargeting() && s.getApi() != ApiType.Counter && s.getTargetRestrictions().getNumCandidates(s) == 0) continue;  // sem alvo
                if (!ComputerUtilMana.canPayManaCost(s, player, 0, false)) return true;  // só com este terreno
            }
            return false;
        }

        // ---------- plano de cemitério (reanimador) ----------
        // Reanimar (Persist, Victimize, Reanimate…): feitiço nosso que traz uma criatura do cemitério para o campo.
        //   - grande no cemitério (custo 5+): é a jogada do turno — logo no Main 1, depois do terreno, e sem guardar mana
        //     para contrafeitiços (a Archon na mesa vale mais do que a resposta);
        //   - só pequenas: no Main 2, quando a IA do Forge já passou, e nunca com uma grande a caminho (na mão sem mana
        //     para a lançar, ou uma Unmarked Grave/Entomb na mão para a pôr lá). O guião do Persist (cards/persist.txt)
        //     já só deixa a IA do Forge escolher criaturas de custo 4+.
        SpellAbility reanimate(boolean fallback) {  // fallback: depois de a IA do Forge passar
            Game g = player.getGame();
            PhaseHandler ph = g.getPhaseHandler();
            if (!g.getStack().isEmpty() || !ph.isPlayerTurn(player) || !ph.getPhase().isMain()) return null;
            List<Card> hand = new ArrayList<>(player.getCardsIn(ZoneType.Hand));
            for (Card c : hand) {
                SpellAbility sa = c.getFirstSpellAbility();
                if (sa == null || sa.getApi() != ApiType.ChangeZone || !sa.isSpell() || !sa.usesTargeting() || sa.getPayCosts() == null
                        || !sa.getPayCosts().isOnlyManaCost() || sa.getTargetRestrictions().getMinTargets(c, sa) > 1
                        || !"Graveyard".equals(sa.getParam("Origin")) || !"Battlefield".equals(sa.getParam("Destination"))) continue;
                sa.setActivatingPlayer(player);
                sa.resetTargets();
                Card best = null;
                int bv = -1;
                for (Card x : player.getCardsIn(ZoneType.Graveyard)) {
                    if (!x.isCreature() || !sa.canTarget(x)) continue;
                    int v = ComputerUtilCard.evaluateCreature(x);
                    if (v > bv) { bv = v; best = x; }
                }
                if (best == null) continue;
                boolean big = best.getCMC() >= 5;
                if (!big && (!fallback || !ph.is(PhaseType.MAIN2) || bigComing(hand))) continue;
                if (big && landFirst(hand)) return null;
                if (!tried.add(ph.getTurn() + ":" + ph.getPhase() + ":" + c.getId() + ":reanimate")) continue;
                if (!sa.canPlay() || !ComputerUtilCost.canPayCost(sa, player, false)) continue;
                int keep = big ? 0 : reserve(hand, c, false);
                if (keep > 0 && !ComputerUtilMana.canPayManaCost(sa, player, keep, false)) continue;
                sa.getTargets().add(best);
                return sa;
            }
            return null;
        }

        // Encher o cemitério (Unmarked Grave, Entomb, Buried Alive…): com um feitiço de reanimar na mão e nada que valha a
        // pena no cemitério, é a primeira coisa a lançar no nosso turno — o Forge deixava-a ~2 turnos na mão a lançar
        // outras coisas. A carta que vai para o cemitério escolhe-a chooseSingleCardForZoneChange (a maior criatura).
        SpellAbility entomb() {
            Game g = player.getGame();
            PhaseHandler ph = g.getPhaseHandler();
            if (!g.getStack().isEmpty() || !ph.isPlayerTurn(player) || !ph.getPhase().isMain()) return null;
            List<Card> hand = new ArrayList<>(player.getCardsIn(ZoneType.Hand));
            if (gyTarget() || !reanimatesIn(hand) || landFirst(hand)) return null;
            for (Card c : hand) {
                SpellAbility sa = c.getFirstSpellAbility();
                if (!entombs(sa) || sa.getPayCosts() == null || !sa.getPayCosts().isOnlyManaCost()) continue;
                if (!tried.add(ph.getTurn() + ":" + ph.getPhase() + ":" + c.getId() + ":entomb")) continue;
                sa.setActivatingPlayer(player);
                if (sa.canPlay() && ComputerUtilCost.canPayCost(sa, player, false)) return sa;
            }
            return null;
        }

        static boolean reanimates(SpellAbility sa) {
            for (SpellAbility s = sa; s != null; s = s.getSubAbility())
                if (s.getApi() == ApiType.ChangeZone && "Graveyard".equals(s.getParam("Origin")) && "Battlefield".equals(s.getParam("Destination"))) return true;
            return false;
        }

        static boolean entombs(SpellAbility sa) {
            return sa != null && sa.isSpell() && sa.getApi() == ApiType.ChangeZone && "Library".equals(sa.getParam("Origin"))
                    && "Graveyard".equals(sa.getParam("Destination"));
        }

        static boolean reanimatesIn(Iterable<Card> cards) {
            for (Card c : cards) if (c.getFirstSpellAbility() != null && c.getFirstSpellAbility().isSpell() && reanimates(c.getFirstSpellAbility())) return true;
            return false;
        }

        boolean reanimator() { return reanimatesIn(player.getCardsIn(ZoneType.Hand)) || reanimatesIn(player.getCardsIn(ZoneType.Library)); }

        // Lendárias contam como alvo se algum feitiço de reanimar do deck as aceitar (Reanimate, Animate Dead, Exhume…);
        // num deck só com Persist e afins («nonLegendary») ficam de fora. Visto uma vez, como millsOpponent().
        Boolean legends;
        boolean legendsOk() {
            if (legends == null) {
                legends = false;
                for (Card c : player.getCardsIn(Arrays.asList(ZoneType.Library, ZoneType.Hand, ZoneType.Graveyard)))
                    for (SpellAbility s = c.getFirstSpellAbility(); s != null && !legends; s = s.getSubAbility()) {
                        if (s.getApi() != ApiType.ChangeZone || !"Graveyard".equals(s.getParam("Origin")) || !"Battlefield".equals(s.getParam("Destination"))) continue;
                        String v = String.valueOf(s.getParam("ValidTgts")) + "," + s.getParam("ChangeType");
                        legends = !v.contains("nonLegendary");
                    }
            }
            return legends;
        }
        boolean bigOk(Card c) { return c.isCreature() && c.getCMC() >= 5 && (!c.getType().isLegendary() || legendsOk()); }

        // grande que se quer no cemitério: criatura de custo 5+ (lendária só se dá para a reanimar) que ainda não dá para lançar
        boolean fat(Card c) { return bigOk(c) && c.getCMC() > player.getLandsInPlay().size() + 1; }

        boolean gyTarget() {
            for (Card c : player.getCardsIn(ZoneType.Graveyard)) if (bigOk(c)) return true;
            return false;
        }

        boolean bigComing(List<Card> hand) {
            for (Card h : hand) if (fat(h) || (h.isCreature() && (!h.getType().isLegendary() || legendsOk()) && h.getCMC() >= 4 && h.getCMC() > player.getLandsInPlay().size()) || entombs(h.getFirstSpellAbility())) return true;
            return false;
        }

        boolean landFirst(List<Card> hand) {  // no Main 1, o terreno do turno vem antes
            return player.getGame().getPhaseHandler().is(PhaseType.MAIN1) && player.getLandsPlayedThisTurn() == 0 && hand.stream().anyMatch(Card::isLand);
        }

        // Descartar da própria mão (Thoughtseize em nós, limite de mão, Faithless Looting…): num deck que reanima, as
        // grandes que não dá para lançar vão primeiro — o Forge deitava fora «a pior carta» e guardava a Archon.
        CardCollection binFats(Iterable<Card> valid, int n) {
            if (n <= 0 || !reanimator()) return null;
            List<Card> fats = new ArrayList<>();
            for (Card c : valid) if (fat(c)) fats.add(c);
            if (fats.isEmpty()) return null;
            fats.sort((x, y) -> ComputerUtilCard.evaluateCreature(y) - ComputerUtilCard.evaluateCreature(x));
            CardCollection out = new CardCollection(fats.subList(0, Math.min(n, fats.size())));
            if (out.size() < n) {
                CardCollection rest = new CardCollection(valid);
                rest.removeAll(out);
                CardCollectionView more = getAi().getCardsToDiscard(n - out.size(), n - out.size(), rest, null);
                if (more != null) out.addAll(more);
            }
            return out;
        }

        @Override
        public CardCollection chooseCardsToDiscardFrom(Player p, SpellAbility sa, CardCollection validCards, int min, int max, CardCollectionView visibleToChooser) {
            CardCollection f = p == player ? binFats(validCards, Math.max(min, Math.min(max, 1))) : null;
            return f != null ? f : super.chooseCardsToDiscardFrom(p, sa, validCards, min, max, visibleToChooser);
        }

        @Override
        public CardCollectionView chooseCardsToDiscardToMaximumHandSize(int numDiscard) {
            CardCollection f = binFats(player.getCardsIn(ZoneType.Hand), numDiscard);
            return f != null ? f : super.chooseCardsToDiscardToMaximumHandSize(numDiscard);
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
                int keep = eot ? 0 : reserve(hand, c, dig);
                if (keep > 0 && !ComputerUtilMana.canPayManaCost(sa, player, keep, false)) { sa.resetTargets(); continue; }
                return sa;
            }
            return null;
        }

        // mana a guardar: a da carta mais cara da mão (fora `c`) que dá para pagar agora — as respostas instantâneas, ou
        // tudo com all=true (no Main 1 a IA do Forge pode estar a guardar mana para lançar criaturas no Main 2)
        int reserve(List<Card> hand, Card c, boolean all) {
            int keep = 0;
            for (Card o : hand) {
                SpellAbility os = o == c || o.isLand() ? null : o.getFirstSpellAbility();
                if (os == null || selects(os) || (!all && SpellAbilityAi.isSorcerySpeed(os, player))) continue;
                os.setActivatingPlayer(player);
                // truque ou remoção sem alvo em jogo não é resposta (contrafeitiços têm alvo só na pilha: contam)
                if (os.usesTargeting() && os.getApi() != ApiType.Counter && os.getTargetRestrictions().getNumCandidates(os) == 0) continue;
                int need = o.getCMC() - o.getManaCost().getPhyrexianCount();  // mana phyrexiana paga-se com vida
                if (need > keep && ComputerUtilMana.canPayManaCost(os, player, 0, false)) keep = need;
            }
            return keep;
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
                Player t = s.getApi() == ApiType.RevealHand || s.getTargetRestrictions().canOnlyTgtOpponent() || (s.getApi() == ApiType.Mill && millsOpponent())
                        ? player.getOpponents().stream().filter(s::canTarget).findFirst().orElse(null)
                        : s.canTarget(player) ? player : null;
                if (t == null) return false;
                s.getTargets().add(t);
            }
            return true;
        }

        // Deck de moer o adversário (Hedron Crab, Dream Twist, Jace…): 8+ cartas que moem um jogador à escolha. Aí o
        // Thought Scour do cantrip() mói o adversário; nos outros (Delver, reanimador) continua a moer-nos a nós.
        Boolean mills;

        boolean millsOpponent() {
            if (mills == null) {
                int n = 0;
                for (Card c : player.getCardsIn(Arrays.asList(ZoneType.Library, ZoneType.Hand, ZoneType.Battlefield, ZoneType.Graveyard))) {
                    List<SpellAbility> all = new ArrayList<>(c.getSpellAbilities());
                    for (forge.game.trigger.Trigger tr : c.getTriggers()) if (tr.ensureAbility() != null) all.add(tr.ensureAbility());
                    boolean m = false;
                    for (SpellAbility a : all)
                        for (SpellAbility s = a; s != null && !m; s = s.getSubAbility())
                            m = s.getApi() == ApiType.Mill && s.usesTargeting() && s.getTargetRestrictions().canTgtPlayer();
                    if (m) n++;
                }
                mills = n >= 8;
            }
            return mills;
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

        // ---------- decks de artefactos (Arcbound Ravager, Inkmoth Nexus, Urza's Saga…) ----------

        // Jogadas da IA do Forge que este passo não deixa fazer: a habilidade fica com AILifeThreshold enorme (o
        // AiController.checkAiSpecificRestrictions recusa-a) só durante o super.chooseSpellAbilityToPlay — assim a IA passa
        // à jogada seguinte que queria fazer em vez de passar a prioridade.
        //   - saídas de sacrifício que só fazem crescer a carta (growSac): decide o sacOutlet;
        //   - no nosso turno, antes dos bloqueios, animar um terreno (Inkmoth Nexus, Mutavault…) ou dar a si própria um
        //     bónus até ao fim do turno (Zabaz: {W} voar) com a mana que faz falta para lançar a carta mais cara que dá
        //     para pagar agora (hungry). O Forge lança as criaturas no Main 2 e gastava antes a mana a atacar com 1/1: num
        //     registo de 27 jogos animou o Inkmoth 92 vezes e o Arcbound Ravager ficou na mão 112 turnos.
        List<SpellAbility> holdBack() {
            List<SpellAbility> held = new ArrayList<>();
            Game g = player.getGame();
            PhaseHandler ph = g.getPhaseHandler();
            int keep = ph.isPlayerTurn(player) && g.getStack().isEmpty() && ph.getPhase().isBefore(PhaseType.COMBAT_DECLARE_BLOCKERS) ? castable() : 0;
            for (Card c : player.getCardsIn(ZoneType.Battlefield))
                for (SpellAbility sa : c.getSpellAbilities()) {
                    if (sa.hasParam("AILifeThreshold") || !sa.isActivatedAbility() || sa.isManaAbility()) continue;
                    if (growSac(sa) == null && (keep == 0 || !hungry(sa, keep))) continue;
                    sa.putParam("AILifeThreshold", "1000000");
                    held.add(sa);
                }
            return held;
        }

        // a mana da carta mais cara da mão que dá para lançar agora (X conta 1; seleção barata fica de fora)
        int castable() {
            int keep = 0;
            for (Card o : player.getCardsIn(ZoneType.Hand)) {
                SpellAbility os = o.isLand() ? null : o.getFirstSpellAbility();
                if (os == null || selects(os)) continue;
                int x = o.getManaCost().countX(), need = o.getManaCost().getCMC() + x - o.getManaCost().getPhyrexianCount();
                if (need <= keep) continue;
                os.setActivatingPlayer(player);
                if (os.usesTargeting() && os.getTargetRestrictions().getNumCandidates(os) == 0) continue;
                if (ComputerUtilMana.canPayManaCost(os, player, x, false)) keep = need;
            }
            return keep;
        }

        // terreno que se anima ou criatura que se dá um bónus até ao fim do turno, com mana, quando depois de a pagar (e,
        // num terreno que vai atacar, sem a mana dele) já não sobra `keep`; um ataque que sozinho mata fica com o Forge
        boolean hungry(SpellAbility sa, int keep) {
            Card c = sa.getHostCard();
            boolean animate = sa.getApi() == ApiType.Animate && c.isLand() && !c.isCreature();
            if (!animate && !(sa.getApi() == ApiType.Pump && c.isCreature()) || sa.usesTargeting() || sa.getPayCosts() == null
                    || sa.getPayCosts().getTotalMana().getCMC() == 0 || !"Self".equals(sa.getParamOrDefault("Defined", "Self"))
                    || "Permanent".equals(sa.getParam("Duration"))) return false;
            sa.setActivatingPlayer(player);
            Player opp = player.getWeakestOpponent();
            int pow = animate ? AbilityUtils.calculateAmount(c, sa.getParamOrDefault("Power", "0"), sa) + c.getCounters(CounterEnumType.P1P1)
                    : c.getNetPower() + AbilityUtils.calculateAmount(c, sa.getParamOrDefault("NumAtt", "0"), sa);
            boolean infect = animate ? sa.getParamOrDefault("Keywords", "").contains("Infect") : c.hasKeyword(Keyword.INFECT);
            if (opp != null && (infect ? opp.getPoisonCounters() + pow >= 10 : opp.getLife() <= pow)) return false;
            return !ComputerUtilMana.canPayManaCost(sa, player, keep + (animate ? 1 : 0), false);
        }

        // «Sacrifica um artefacto: +1/+1 neste» (Arcbound Ravager) e afins: habilidade sem alvo que só faz crescer a carta,
        // custo = sacrificar 1 outra permanente (+ mana). O CountersPutAi usava-a sempre que o getCardPreference achava o
        // que sacrificar — o Haywire Mite (SacMe), com 6+ terrenos o Darksteel Citadel, no perfil Experimental tudo de custo
        // 0–1 —, no Main 1 ou 2 e sem nada em jogo: num registo de 27 jogos o Ravager comeu 6 Citadels, 4 Mox Opal e 3
        // The Ozolith assim. Fica com o sacOutlet.
        static CostSacrifice growSac(SpellAbility sa) {
            if (!sa.isActivatedAbility() || sa.isManaAbility() || sa.isPwAbility() || sa.hasParam("AILogic") || sa.usesTargeting()
                    || sa.getSubAbility() != null || (sa.getApi() != ApiType.PutCounter && sa.getApi() != ApiType.Pump)
                    || !"Self".equals(sa.getParamOrDefault("Defined", "Self")) || sa.getPayCosts() == null) return null;
            CostSacrifice sac = null;
            for (CostPart p : sa.getPayCosts().getCostParts()) {
                if (p instanceof CostSacrifice s && !s.payCostFromSource() && "1".equals(s.getAmount())) sac = s;
                else if (!(p instanceof CostPartMana)) return null;
            }
            return sac;
        }

        // Quando um jogador sacrifica para a saída (o que escolhe vai em `victim` e o playChosenSpellAbility marca-o com
        // SacMe 6 para o pagamento do custo o escolher):
        //   - em resposta a um feitiço/habilidade do adversário, o que dele está ameaçado (destruir, dano, exilar; devolver
        //     à mão só fichas), o mais valioso; a própria carta só com Modular e contra exílio (morta, o Modular já dispara);
        //   - no combate, já com os bloqueios, uma criatura nossa que vai morrer sem levar o adversário com ela (o Modular
        //     dela passa os marcadores e esta cresce; sem atropelar: um bloqueador sacrificado não deixa passar dano);
        //   - para matar: atacante não bloqueado, quando com +1 por cada permanente que se pode sacrificar (fora os outros
        //     atacantes não bloqueados) o dano — ou o veneno, com infect — chega; vai primeiro o que não é criatura nem terreno.
        final Map<SpellAbility, Card> victim = new HashMap<>();

        SpellAbility sacOutlet() {
            Game g = player.getGame();
            PhaseHandler ph = g.getPhaseHandler();
            Combat cb = g.getCombat();
            SpellAbility top = g.getStack().isEmpty() ? null : g.getStack().peekAbility();
            if (top != null && !top.getActivatingPlayer().isOpponentOf(player)) return null;
            if (top == null && (cb == null || !ph.is(PhaseType.COMBAT_DECLARE_BLOCKERS))) return null;
            List<GameObject> threat = top == null ? List.of() : ComputerUtil.predictThreatenedObjects(player, null, true);
            boolean zone = top != null && (top.getApi() == ApiType.ChangeZone || top.getApi() == ApiType.ChangeZoneAll);
            boolean exile = zone && "Exile".equals(top.getParam("Destination")), bounce = zone && !exile && !"Graveyard".equals(top.getParam("Destination"));
            if (top != null && threat.isEmpty()) return null;
            for (Card src : player.getCardsIn(ZoneType.Battlefield)) {
                for (SpellAbility sa : src.getSpellAbilities()) {
                    CostSacrifice sac = growSac(sa);
                    if (sac == null) continue;
                    sa.setActivatingPlayer(player);
                    if (!sa.canPlay() || !ComputerUtilCost.canPayCost(sa, player, false)) continue;
                    CardCollection fodder = CardLists.filter(CardLists.getValidCards(player.getCardsIn(ZoneType.Battlefield),
                            sac.getType().split(";"), player, src, sa), CardPredicates.canBeSacrificedBy(sa, false));
                    Card v = null;
                    if (top != null) {
                        int best = -1;
                        for (Card x : fodder) {
                            if (!threat.contains(x) || (bounce && !x.isToken()) || (x == src && !(exile && src.hasKeyword(Keyword.MODULAR)))) continue;
                            int val = x.isCreature() ? ComputerUtilCard.evaluateCreature(x) : 100 + x.getCMC();
                            if (val > best) { best = val; v = x; }
                        }
                    } else {
                        for (Card x : fodder) {
                            if (x == src || !x.isCreature() || !(cb.isAttacking(x) || cb.isBlocking(x)) || !ComputerUtilCombat.combatantWouldBeDestroyed(player, x, cb)) continue;
                            boolean keep = false;
                            if (cb.isBlocking(x)) for (Card a : cb.getAttackersBlockedBy(x)) keep |= a.hasKeyword(Keyword.TRAMPLE) || ComputerUtilCombat.attackerWouldBeDestroyed(player, a, cb);
                            else for (Card b : cb.getBlockers(x)) keep |= ComputerUtilCombat.blockerWouldBeDestroyed(player, b, cb);
                            if (!keep) { v = x; break; }
                        }
                        if (v == null && cb.isAttacking(src) && cb.isUnblocked(src)) v = lethalFodder(src, fodder, cb);
                    }
                    if (v == null || !tried.add(ph.getTurn() + ":" + ph.getPhase() + ":" + g.getStack().size() + ":" + sa.getId() + ":" + v.getId() + ":sac")) continue;
                    victim.put(sa, v);
                    return sa;
                }
            }
            return null;
        }

        Card lethalFodder(Card src, CardCollection fodder, Combat cb) {
            Player opp = cb.getDefenderPlayerByAttacker(src);
            if (opp == null) return null;
            int dmg = 0, poison = 0;
            for (Card a : cb.getAttackers())
                if (cb.isUnblocked(a) && cb.getDefenderPlayerByAttacker(a) == opp) {
                    if (a.hasKeyword(Keyword.INFECT)) poison += a.getNetCombatDamage(); else dmg += a.getNetCombatDamage();
                }
            List<Card> free = new ArrayList<>();
            for (Card x : fodder) if (x != src && !(cb.isAttacking(x) && cb.isUnblocked(x))) free.add(x);
            int need = src.hasKeyword(Keyword.INFECT) ? 10 - opp.getPoisonCounters() - poison : opp.canLoseLife() ? opp.getLife() - dmg : Integer.MAX_VALUE;
            if (need <= 0 || need > free.size()) return null;
            free.sort(Comparator.comparingInt((Card x) -> x.isCreature() ? 2 : x.isLand() ? 1 : 0).thenComparingInt(Card::getCMC));
            return free.get(0);
        }

        @Override
        public boolean playChosenSpellAbility(SpellAbility sa) {
            Card v = victim.remove(sa);
            if (v == null) return super.playChosenSpellAbility(sa);
            String old = v.hasSVar("SacMe") ? v.getSVar("SacMe") : null;
            v.setSVar("SacMe", "6");  // ComputerUtil.getCardPreference("SacCost") escolhe primeiro o SacMe mais alto
            try {
                return super.playChosenSpellAbility(sa);
            } finally {
                if (old == null) v.removeSVar("SacMe"); else v.setSVar("SacMe", old);
            }
        }

        // Fichas por habilidade (Urza's Saga II: «{2},{T}: Construct 0/0 com +1/+1 por artefacto»): o TokenAi só as faz no
        // turno do adversário (a partir dos atacantes) e com 80% de sorte; com a mana gasta no nosso turno e a Saga
        // sacrificada no capítulo III, em 25 Sagas houve 4 Constructs. Aqui também no Main 2 do nosso turno com a mana que
        // sobra (guardando a das respostas instantâneas), no fim do turno do adversário antes do nosso e em resposta ao
        // último capítulo da Saga (a última ocasião). Só custos de mana e/ou {T}, ficha criatura com resistência >= 1.
        SpellAbility construct() {
            Game g = player.getGame();
            PhaseHandler ph = g.getPhaseHandler();
            boolean mine = ph.isPlayerTurn(player);
            boolean main2 = mine && ph.is(PhaseType.MAIN2) && g.getStack().isEmpty();
            boolean eot = !mine && ph.is(PhaseType.END_OF_TURN) && ph.getNextTurn() == player && g.getStack().isEmpty();
            for (Card c : player.getCardsIn(ZoneType.Battlefield)) {
                boolean last = mine && c.isSaga() && !g.getStack().isEmpty() && c.getCounters(CounterEnumType.LORE) >= c.getFinalChapterNr();
                if (!main2 && !eot && !last) continue;
                for (SpellAbility sa : c.getSpellAbilities()) {
                    if (sa.getApi() != ApiType.Token || !sa.isActivatedAbility() || sa.isPwAbility() || sa.usesTargeting() || !sa.hasParam("TokenScript")
                            || sa.getPayCosts() == null || !sa.getPayCosts().isReusuableResource()) continue;
                    if (!tried.add(ph.getTurn() + ":" + ph.getPhase() + ":" + g.getStack().size() + ":" + sa.getId() + ":token")) continue;
                    sa.setActivatingPlayer(player);
                    if (!sa.canPlay() || !ComputerUtilCost.canPayCost(sa, player, false)) continue;
                    Card t = TokenAi.spawnToken(player, sa);
                    if (t == null || !t.isCreature() || t.getNetToughness() < 1 || (t.getType().isLegendary() && player.isCardInPlay(t.getName()))) continue;
                    int keep = main2 ? reserve(new ArrayList<>(player.getCardsIn(ZoneType.Hand)), null, false) : 0;
                    if (keep > 0 && !ComputerUtilMana.canPayManaCost(sa, player, keep, false)) continue;
                    return sa;
                }
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
