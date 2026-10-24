// Grimório — abre o Forge (GUI desktop, Forge 2.0.15, GPL-3.0) e começa logo um jogo contra a IA, sem menus.
// Uso: java -cp forge.jar:ext GrimorioPlay <humano.dck|-> <ia.dck|-> <Constructed|Commander|Oathbreaker|Brawl> <nomeHumano> <nomeIA> [estado.txt]
// - com decks: jogo normal (o mesmo que o ecrã "Constructed" do Forge com esses dois decks; perfil da IA = preferência
//   UI_CURRENT_AI_PROFILE escrita pelo play.py);
// - com estado.txt: retoma uma posição (formato GameState do Forge, o mesmo dos puzzles: humanlife=…, aibattlefield=…).
//   Joga-se como GameType.Puzzle sem objetivo (sem mulligan; as zonas, a vida, o turno e a fase vêm do ficheiro);
//   linhas extra "humancommandercasts=Nome=2;Outro=1" põem o imposto de comandante.
// No fim do jogo o Forge volta ao menu principal e os decks continuam nas listas (decks/constructed, decks/commander).
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;

import javax.swing.SwingUtilities;

import forge.GuiDesktop;
import forge.LobbyPlayer;
import forge.Singletons;
import forge.deck.Deck;
import forge.deck.io.DeckSerializer;
import forge.game.Game;
import forge.game.GameRules;
import forge.game.GameState;
import forge.game.GameType;
import forge.game.card.Card;
import forge.game.player.Player;
import forge.game.player.RegisteredPlayer;
import forge.gamemodes.match.HostedMatch;
import forge.gui.GuiBase;
import forge.player.GamePlayerUtil;

public class GrimorioPlay {
    public static void main(String[] args) throws Exception {
        Thread.setDefaultUncaughtExceptionHandler((t, ex) -> { System.err.println("Uncaught exception in thread " + t.getName() + ":"); ex.printStackTrace(); });
        System.setProperty("java.util.Arrays.useLegacyMergeSort", "true");
        // o mesmo arranque que forge.view.Main sem argumentos, sem o Sentry (relatórios para fora)
        GuiBase.setInterface(new GuiDesktop());
        Singletons.initializeOnce(true);
        Singletons.getControl().initialize();
        // a janela principal é montada no EDT (invokeLater); esperar que assente antes de abrir o jogo
        for (int i = 0; i < 3; i++) SwingUtilities.invokeAndWait(() -> { });
        Thread.sleep(1500);
        SwingUtilities.invokeLater(() -> {
            try {
                start(args);
            } catch (Exception e) {
                e.printStackTrace();
            }
        });
    }

    static void start(String[] a) throws Exception {
        String gtype = a[2];
        Set<GameType> variants = gtype.equals("Constructed") ? EnumSet.noneOf(GameType.class) : EnumSet.of(GameType.valueOf(gtype));
        LobbyPlayer human = GamePlayerUtil.getGuiPlayer();
        human.setName(a[3]);
        LobbyPlayer ai = GamePlayerUtil.createAiPlayer(a[4]);  // perfil = UI_CURRENT_AI_PROFILE
        HostedMatch hm = GuiBase.getInterface().hostMatch();
        List<RegisteredPlayer> players = new ArrayList<>();
        RegisteredPlayer rh, ra;
        if (a.length > 5) {
            List<String> lines = Files.readAllLines(new File(a[5]).toPath(), StandardCharsets.UTF_8);
            rh = new RegisteredPlayer(new Deck());
            ra = new RegisteredPlayer(new Deck());
            rh.setStartingHand(0);
            ra.setStartingHand(0);
            hm.setStartGameHook(() -> applyState(hm.getGame(), lines));  // também em "Reiniciar": volta à mesma posição
            GameRules rules = new GameRules(GameType.Puzzle);
            rules.setGamesPerMatch(1);
            if (!variants.isEmpty()) rules.setAppliedVariants(variants);
            players.add(rh.setPlayer(human));
            players.add(ra.setPlayer(ai));
            hm.startMatch(rules, null, players, rh, GuiBase.getInterface().getNewGuiGame());
            return;
        }
        Deck dh = DeckSerializer.fromFile(new File(a[0])), da = DeckSerializer.fromFile(new File(a[1]));
        rh = variants.isEmpty() ? new RegisteredPlayer(dh) : RegisteredPlayer.forVariants(2, variants, dh, null, false, null, null);
        ra = variants.isEmpty() ? new RegisteredPlayer(da) : RegisteredPlayer.forVariants(2, variants, da, null, false, null, null);
        players.add(rh.setPlayer(human));
        players.add(ra.setPlayer(ai));
        hm.startMatch(GameType.Constructed, variants, players, rh, GuiBase.getInterface().getNewGuiGame());
    }

    static void applyState(Game game, List<String> lines) {
        Map<String, Integer> casts = new HashMap<>();  // "0:Nome" -> vezes lançado da zona de comando
        List<String> std = new ArrayList<>();
        for (String l : lines) {
            String k = l.contains("=") ? l.substring(0, l.indexOf('=')).trim().toLowerCase() : "";
            if (k.endsWith("commandercasts")) {
                int p = k.startsWith("human") ? 0 : 1;
                for (String kv : l.substring(l.indexOf('=') + 1).split(";")) {
                    int i = kv.lastIndexOf('=');
                    if (i > 0) casts.put(p + ":" + kv.substring(0, i).trim(), Integer.parseInt(kv.substring(i + 1).trim()));
                }
            } else {
                std.add(l);
            }
        }
        GameState gs = new GameState() {
            @Override
            protected void applyGameOnThread(Game g) {
                super.applyGameOnThread(g);
                for (int i = 0; i < g.getPlayers().size(); i++) {
                    Player p = g.getPlayers().get(i);
                    for (Card c : p.getCommanders()) {
                        for (int n = casts.getOrDefault(i + ":" + c.getName(), 0); n > 0; n--) p.incCommanderCast(c);
                    }
                }
            }
        };
        gs.parse(std);
        gs.applyToGame(game);
    }
}
