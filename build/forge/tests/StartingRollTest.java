import java.util.*;
import com.google.gson.*;

public class StartingRollTest {
    public static void main(String[] args) {
        int[] values = {20, 20, 4, 7, 7, 12, 1};
        Random scripted = new Random() {
            int at = 0;
            @Override public int nextInt(int bound) {
                if (bound != 20 || at >= values.length) throw new AssertionError("Unexpected roll");
                return values[at++] - 1;
            }
        };
        JsonObject r = GrimorioNet.startingRoll(Arrays.asList("A", "B", "C"), scripted);
        if (!r.get("winner").getAsString().equals("A") || r.get("index").getAsInt() != 0) throw new AssertionError(r);
        JsonArray rounds = r.getAsJsonArray("rounds");
        if (rounds.size() != 3 || rounds.get(0).getAsJsonArray().size() != 3 || rounds.get(1).getAsJsonArray().size() != 2) throw new AssertionError(r);
        for (int n = 2; n <= 6; n++) for (int seed = 0; seed < 100; seed++) {
            List<String> names = new ArrayList<>(); for (int i = 0; i < n; i++) names.add("P" + i);
            r = GrimorioNet.startingRoll(names, new Random(seed));
            Set<String> eligible = new HashSet<>(names);
            for (JsonElement re : r.getAsJsonArray("rounds")) {
                Set<String> seen = new HashSet<>(), leaders = new HashSet<>(); int high = 0;
                for (JsonElement pe : re.getAsJsonArray()) {
                    JsonObject p = pe.getAsJsonObject(); String name = p.get("name").getAsString(); int v = p.get("v").getAsInt();
                    if (!seen.add(name) || !eligible.contains(name) || v < 1 || v > 20) throw new AssertionError(r);
                    if (v > high) { high = v; leaders.clear(); } if (v == high) leaders.add(name);
                }
                if (!seen.equals(eligible)) throw new AssertionError(r); eligible = leaders;
            }
            if (eligible.size() != 1 || !eligible.contains(r.get("winner").getAsString()) || !names.get(r.get("index").getAsInt()).equals(r.get("winner").getAsString())) throw new AssertionError(r);
        }
        System.out.println("starting roll: repeated top ties and 500 seeded games passed");
    }
}
