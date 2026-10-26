// Limitado no Grimório: booster draft e selado com o motor do próprio Forge (packs reais de cada set, a IA de draft dos
// bots e os construtores de decks de 40). Fala em linhas JSON (@@GD {...}) como o GrimorioNet:
//   sets                          -> {t:sets, sets:[{code, name, date, type}]}   os sets com boosters
//   draft <SET,SET,SET> human|bots -> por cada escolha tua {t:pack, round, pick, cards, pool}; responde-se {"pick": i}
//   sealed <SET x6> <n> human|bots -> sem perguntas
// e no fim {t:done, players:[{seat, pool, deck:{main, side}, colors}]} (lugar 0 = tu; o teu deck é só uma sugestão).
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.*;

import com.google.gson.*;

import forge.GuiDesktop;
import forge.card.CardEdition;
import forge.deck.CardPool;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.gamemodes.limited.*;
import forge.gui.GuiBase;
import forge.item.PaperCard;
import forge.item.SealedTemplate;
import forge.item.generation.UnOpenedProduct;
import forge.model.FModel;

public class GrimorioDraft {
    static final Set<CardEdition.Type> TYPES = EnumSet.of(CardEdition.Type.CORE, CardEdition.Type.EXPANSION, CardEdition.Type.DRAFT, CardEdition.Type.REPRINT);

    static void out(JsonObject o) {
        System.out.println("@@GD " + o);
        System.out.flush();
    }

    static JsonObject card(PaperCard c) {
        JsonObject o = new JsonObject();
        o.addProperty("n", c.getName());
        o.addProperty("s", c.getEdition());
        o.addProperty("cn", c.getCollectorNumber());
        o.addProperty("r", String.valueOf(c.getRarity()));
        return o;
    }

    static JsonArray cards(Iterable<PaperCard> l) {
        JsonArray a = new JsonArray();
        for (PaperCard c : l) a.add(card(c));
        return a;
    }

    static JsonObject counts(CardPool p) {
        JsonObject o = new JsonObject();
        if (p == null) return o;
        for (Map.Entry<PaperCard, Integer> e : p) {
            String n = e.getKey().getName();
            o.addProperty(n, (o.has(n) ? o.get(n).getAsInt() : 0) + e.getValue());
        }
        return o;
    }

    static SealedTemplate booster(String code) {
        SealedTemplate t = FModel.getMagicDb().getBoosters().get(code);
        if (t == null) throw new IllegalArgumentException("O set " + code + " não tem boosters no Forge.");
        return t;
    }

    static String landSet(String code) {
        CardEdition e = FModel.getMagicDb().getEditions().get(code);
        return e != null ? e.getCode() : null;
    }

    // o deck de 40 de um pool; se o construtor do Forge falhar (pool estranho) fica o pool como sideboard
    static JsonObject deck(Deck d, List<PaperCard> pool) {
        JsonObject o = new JsonObject();
        o.add("main", d != null ? counts(d.getMain()) : new JsonObject());
        o.add("side", d != null ? counts(d.get(DeckSection.Sideboard)) : counts(poolOf(pool)));
        return o;
    }

    static CardPool poolOf(List<PaperCard> l) {
        CardPool p = new CardPool();
        p.addAllFlat(l);
        return p;
    }

    static Deck sealedDeck(List<PaperCard> pool, String land) {
        try {
            return new SealedDeckBuilder(new ArrayList<>(pool)).buildDeck(land);  // cópia: o construtor consome a lista
        } catch (Exception ex) {
            ex.printStackTrace();
            return null;
        }
    }

    // um BoosterDraft com os packs que escolhemos (o createDraft do Forge quer um bloco e pergunta coisas por janela)
    static class Draft extends BoosterDraft {
        Draft(int n) {
            super(LimitedPoolType.Block, n);
        }

        void add(String code) {
            product.add(new UnOpenedProduct(booster(code)));
        }
    }

    public static void main(String[] a) throws Exception {
        System.setProperty("java.awt.headless", "true");
        System.setProperty("java.util.Arrays.useLegacyMergeSort", "true");
        GuiBase.setInterface(new GuiDesktop());
        FModel.initialize(null, null);
        String mode = a.length > 0 ? a[0] : "sets";
        try {
            switch (mode) {
                case "sets" -> sets();
                case "draft" -> draft(a[1].split(","), a.length > 2 && a[2].equals("human"));
                case "sealed" -> sealed(a[1].split(","), Integer.parseInt(a[2]), a.length > 3 && a[3].equals("human"));
                default -> throw new IllegalArgumentException("modo desconhecido: " + mode);
            }
        } catch (Exception ex) {
            ex.printStackTrace();
            JsonObject o = new JsonObject();
            o.addProperty("t", "error");
            o.addProperty("msg", String.valueOf(ex.getMessage()));
            out(o);
        }
        System.exit(0);
    }

    static void sets() {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd");
        List<CardEdition> l = new ArrayList<>();
        for (CardEdition e : FModel.getMagicDb().getEditions())
            if (TYPES.contains(e.getType()) && FModel.getMagicDb().getBoosters().contains(e.getCode()) && !e.getName().contains("Conspiracy"))
                l.add(e);
        l.sort((x, y) -> y.getDate().compareTo(x.getDate()));
        JsonArray arr = new JsonArray();
        for (CardEdition e : l) {
            JsonObject o = new JsonObject();
            o.addProperty("code", e.getCode());
            o.addProperty("name", e.getName());
            o.addProperty("date", f.format(e.getDate()));
            o.addProperty("type", e.getType().name());
            arr.add(o);
        }
        JsonObject o = new JsonObject();
        o.addProperty("t", "sets");
        o.add("sets", arr);
        out(o);
    }

    static void draft(String[] codes, boolean human) throws Exception {
        Draft d = new Draft(8);
        for (String c : codes) d.add(c);
        IBoosterDraft.LAND_SET_CODE[0] = FModel.getMagicDb().getEditions().get(codes[0]);
        IBoosterDraft.CUSTOM_RANKINGS_FILE[0] = null;
        if (!human) d.setHumanSeats(Collections.emptySet());  // o lugar 0 também é um bot
        d.initializeBoosters();
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        int pick = 0, round = -1;
        while (d.hasNextChoice()) {
            CardPool pack = d.nextChoice();
            if (pack == null) break;
            List<PaperCard> l = pack.toFlatList();
            if (d.getRound() != round) { round = d.getRound(); pick = 0; }
            pick++;
            LimitedPlayer me = d.getHumanPlayer();
            PaperCard choice;
            if (me instanceof LimitedPlayerAI ai) {
                choice = ai.chooseCard();
            } else {
                JsonObject o = new JsonObject();
                o.addProperty("t", "pack");
                o.addProperty("round", round);
                o.addProperty("rounds", d.getNumRounds());
                o.addProperty("pick", pick);
                o.add("cards", cards(l));
                o.add("pool", cards(me.getDeck().getOrCreate(DeckSection.Sideboard).toFlatList()));
                out(o);
                String line = in.readLine();
                if (line == null) return;  // o servidor fechou: acabou
                int i = JsonParser.parseString(line).getAsJsonObject().get("pick").getAsInt();
                choice = l.get(Math.max(0, Math.min(l.size() - 1, i)));
            }
            if (choice == null) { d.skipChoice(); continue; }
            d.setChoice(choice, DeckSection.Sideboard);
        }
        d.postDraftActions();
        String land = landSet(codes[0]);
        JsonArray ps = new JsonArray();
        List<LimitedPlayer> all = d.getAllPlayers();
        for (LimitedPlayer p : all) {
            List<PaperCard> pool = p.getDeck().getOrCreate(DeckSection.Sideboard).toFlatList();
            Deck built = p instanceof LimitedPlayerAI ai ? ai.buildDeck(land) : sealedDeck(pool, land);
            JsonObject o = new JsonObject();
            o.addProperty("seat", ps.size());
            o.add("pool", cards(pool));
            o.add("deck", deck(built, pool));
            ps.add(o);
        }
        JsonObject o = new JsonObject();
        o.addProperty("t", "done");
        o.add("players", ps);
        out(o);
    }

    static void sealed(String[] codes, int n, boolean human) {
        String land = landSet(codes[0]);
        IBoosterDraft.LAND_SET_CODE[0] = FModel.getMagicDb().getEditions().get(codes[0]);
        JsonArray ps = new JsonArray();
        for (int s = 0; s < Math.max(2, Math.min(16, n)); s++) {
            List<PaperCard> pool = new ArrayList<>();
            for (String c : codes) pool.addAll(new UnOpenedProduct(booster(c)).get());
            JsonObject o = new JsonObject();
            o.addProperty("seat", s);
            o.add("pool", cards(pool));
            o.add("deck", deck(sealedDeck(pool, land), pool));
            ps.add(o);
        }
        JsonObject o = new JsonObject();
        o.addProperty("t", "done");
        o.add("players", ps);
        out(o);
    }
}
