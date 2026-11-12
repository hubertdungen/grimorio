package com.hubertdungen.grimorio;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Os dados das cartas (data/ e meta/: cards.json, emb.bin, pos.bin, combos.json, tokens.json, o meta dos torneios), como
 * nos pacotes de computador (packaging/launcher.py install_data): o grimorio-data.zip da release desta versão (~11 MB;
 * ~38 MB desembrulhado), verificado pelo .sha256 e trocado de uma vez. A transferência retoma onde parou (.part).
 */
final class CardData {
    static final String REPO = "hubertdungen/grimorio";

    interface Progress { void on(long done, long total); }

    private CardData() { }

    static boolean have(File d) { return new File(d, "data/meta.json").isFile(); }

    /** A versão da app cujos dados estão instalados (null: nenhuns, ou feitos à mão). */
    static String installed(File d) { return LocalServer.read(new File(d, "data-release.txt")); }

    /** Faltam ou são de outra versão da app. */
    static boolean outdated(File d, String ver) { return !have(d) || !ver.equals(installed(d)); }

    /** Builds de teste (0.0.0-…) e sem versão: os da release mais recente. */
    static String url(String ver) {
        boolean test = ver == null || ver.isEmpty() || ver.startsWith("0.0.0") || "?".equals(ver);
        return "https://github.com/" + REPO + "/releases/" + (test ? "latest/download" : "download/v" + ver) + "/grimorio-data.zip";
    }

    /** Descarrega, verifica e instala. Lança o erro (sem rede, sem espaço, transferência estragada). */
    static void install(File d, String ver, Progress cb, AtomicBoolean cancel) throws Exception {
        File tmp = new File(d, ".download");
        tmp.mkdirs();
        String u = url(ver);
        File part = new File(tmp, "grimorio-data-" + ver.replaceAll("[^A-Za-z0-9.-]", "_") + ".zip.part");
        for (File f : tmp.listFiles()) if (f.getName().endsWith(".part") && !f.equals(part)) f.delete();  // de outra versão
        String want = null;
        try { want = text(u + ".sha256").trim().split("\\s+")[0].toLowerCase(); } catch (IOException ignored) { }  // sem .sha256: segue
        fetch(u, part, cb, cancel);
        if (want != null && !want.equals(sha256(part))) {
            part.delete();  // a próxima tentativa começa do zero
            throw new IOException("a transferência veio estragada (checksum)");
        }
        File fresh = new File(tmp, "new");
        LocalServer.deleteTree(fresh);
        try (InputStream in = new FileInputStream(part)) { LocalServer.unzip(in, fresh, new String[]{"data/", "meta/"}); }
        if (!new File(fresh, "data/meta.json").isFile()) throw new IOException("o zip não traz data/meta.json");
        for (String top : new String[]{"data", "meta"}) {  // troca de uma vez: o servidor nunca vê metade dos ficheiros
            File src = new File(fresh, top), dst = new File(d, top), old = new File(d, top + ".old");
            if (!src.isDirectory()) continue;
            LocalServer.deleteTree(old);
            if (dst.exists() && !dst.renameTo(old)) throw new IOException("não consegui substituir " + dst);
            if (!src.renameTo(dst)) throw new IOException("não consegui criar " + dst);
            LocalServer.deleteTree(old);
        }
        LocalServer.write(new File(d, "data-release.txt"), ver);
        LocalServer.deleteTree(tmp);
    }

    private static HttpURLConnection open(String u, long from) throws IOException {
        HttpURLConnection h = (HttpURLConnection) new URL(u).openConnection();  // o GitHub redireciona (https -> https: segue)
        h.setConnectTimeout(20000);
        h.setReadTimeout(60000);
        h.setRequestProperty("User-Agent", "Grimorio-android");
        if (from > 0) h.setRequestProperty("Range", "bytes=" + from + "-");
        return h;
    }

    private static String text(String u) throws IOException {
        HttpURLConnection h = open(u, 0);
        try (InputStream in = h.getInputStream()) {
            byte[] b = new byte[4096];
            int n = in.read(b);
            return n > 0 ? new String(b, 0, n, "UTF-8") : "";
        } finally {
            h.disconnect();
        }
    }

    /** url -> part, continuando o que já lá estiver (Range); 200 em vez de 206 = o servidor recomeça do início. */
    private static void fetch(String u, File part, Progress cb, AtomicBoolean cancel) throws IOException {
        long have = part.isFile() ? part.length() : 0;
        HttpURLConnection h = open(u, have);
        try {
            int code = h.getResponseCode();
            if (code == 416) return;  // já estava tudo (o checksum confirma)
            if (code != 200 && code != 206) throw new IOException("HTTP " + code + " em " + u);
            boolean append = code == 206 && have > 0;
            if (!append) have = 0;
            long len = h.getContentLengthLong(), total = len > 0 ? have + len : -1;
            byte[] buf = new byte[1 << 16];
            long last = 0;
            try (InputStream in = h.getInputStream(); OutputStream o = new FileOutputStream(part, append)) {
                for (int r; (r = in.read(buf)) > 0; ) {
                    if (cancel != null && cancel.get()) throw new IOException("cancelado");
                    o.write(buf, 0, r);
                    have += r;
                    long now = System.currentTimeMillis();
                    if (cb != null && now - last > 150) { last = now; cb.on(have, total); }
                }
            }
            if (cb != null) cb.on(have, total);
        } finally {
            h.disconnect();
        }
    }

    static String sha256(File f) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] buf = new byte[1 << 16];
        try (InputStream in = new FileInputStream(f)) { for (int r; (r = in.read(buf)) > 0; ) md.update(buf, 0, r); }
        StringBuilder s = new StringBuilder();
        for (byte b : md.digest()) s.append(String.format("%02x", b));
        return s.toString();
    }
}
