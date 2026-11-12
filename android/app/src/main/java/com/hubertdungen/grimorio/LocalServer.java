package com.hubertdungen.grimorio;

import android.content.Context;
import android.content.SharedPreferences;

import com.chaquo.python.PyObject;
import com.chaquo.python.Python;
import com.chaquo.python.android.AndroidPlatform;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.URL;
import java.security.SecureRandom;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * O Grimório a correr no próprio telemóvel: o server.py (Python do Chaquopy) em http://127.0.0.1:&lt;porta&gt;, com os dados
 * em &lt;files&gt;/grimorio (privados da app). Arranca uma vez por processo; a app fecha-o quando sai (MainActivity.onDestroy).
 */
final class LocalServer {
    static final String HOST = "127.0.0.1";
    private static final int FIRST_PORT = 8107, LAST_PORT = 8126;  // como os pacotes de computador
    private static int port = -1;

    private LocalServer() { }

    static File dataDir(Context c) { return new File(c.getFilesDir(), "grimorio"); }

    static String url() { return "http://" + HOST + ":" + port + "/"; }

    static boolean running() { return port > 0; }

    /** Um segredo por instalação: o servidor só responde a quem traz o cookie grimorio_app (a WebView desta app). */
    static String token(SharedPreferences p) {
        String t = p.getString("token", "");
        if (t.length() < 32) {
            byte[] b = new byte[24];
            new SecureRandom().nextBytes(b);
            StringBuilder s = new StringBuilder();
            for (byte x : b) s.append(String.format("%02x", x));
            t = s.toString();
            p.edit().putString("token", t).apply();
        }
        return t;
    }

    /**
     * Desembrulha o código (se a app mudou), escolhe a porta, arranca o Python e espera que responda. Corre fora da
     * thread do ecrã; devolve o endereço ou lança o erro para a app mostrar.
     */
    static synchronized String start(Context c, SharedPreferences p) throws Exception {
        if (port > 0) return url();
        File app = unpackApp(c);
        File data = dataDir(c);
        if (!data.isDirectory() && !data.mkdirs()) throw new IOException("sem espaço para os dados");
        // a mesma porta de sempre: as preferências do ecrã (língua, deck aberto…) ficam guardadas por http://127.0.0.1:<porta>
        int want = p.getInt("port", FIRST_PORT), use = -1;
        if (free(want)) use = want;
        for (int q = FIRST_PORT; use < 0 && q <= LAST_PORT; q++) if (free(q)) use = q;
        if (use < 0) use = anyFree();
        p.edit().putInt("port", use).apply();
        if (!Python.isStarted()) Python.start(new AndroidPlatform(c.getApplicationContext()));
        PyObject m = Python.getInstance().getModule("grimorio_android");
        m.callAttr("start", app.getAbsolutePath(), data.getAbsolutePath(), use, token(p), BuildConfigVersion.name(c));
        String tok = token(p);
        for (int i = 0; i < 240; i++) {  // até 2 min: a primeira vez cria a base de dados
            int code = health(use, tok);
            if (code == 200 || code == 503) { port = use; return url(); }
            String err = m.callAttr("error").toString();
            if (!err.isEmpty()) throw new IOException(err);
            Thread.sleep(500);
        }
        throw new IOException("o Grimório não arrancou a tempo");
    }

    /** A app vai fechar: o servidor pára (os pedidos a meio acabam primeiro). */
    static synchronized void stop() {
        if (port < 0 || !Python.isStarted()) return;
        try { Python.getInstance().getModule("grimorio_android").callAttr("stop"); } catch (Exception ignored) { }
        port = -1;
    }

    static int health(int p, String tok) {
        HttpURLConnection h = null;
        try {
            h = (HttpURLConnection) new URL("http://" + HOST + ":" + p + "/api/health").openConnection();
            h.setConnectTimeout(1000);
            h.setReadTimeout(3000);
            h.setRequestProperty("Cookie", "grimorio_app=" + tok);
            return h.getResponseCode();
        } catch (IOException e) {
            return -1;
        } finally {
            if (h != null) h.disconnect();
        }
    }

    private static boolean free(int p) {
        try (ServerSocket s = new ServerSocket(p, 1, InetAddress.getByName(HOST))) { return true; } catch (IOException e) { return false; }
    }

    private static int anyFree() throws IOException {
        try (ServerSocket s = new ServerSocket(0, 1, InetAddress.getByName(HOST))) { return s.getLocalPort(); }
    }

    /**
     * assets/grimorio-app.zip (server.py &amp; co + web/dist, feito pelo Gradle) -> &lt;files&gt;/app. Só quando a app foi instalada
     * ou atualizada (lastUpdateTime); troca a pasta inteira de uma vez.
     */
    static File unpackApp(Context c) throws Exception {
        File dir = new File(c.getFilesDir(), "app"), stamp = new File(dir, ".stamp");
        String want = String.valueOf(c.getPackageManager().getPackageInfo(c.getPackageName(), 0).lastUpdateTime);
        if (want.equals(read(stamp))) return dir;
        File tmp = new File(c.getFilesDir(), "app.new");
        deleteTree(tmp);
        try (InputStream in = c.getAssets().open("grimorio-app.zip")) { unzip(in, tmp, null); }
        write(new File(tmp, ".stamp"), want);
        File old = new File(c.getFilesDir(), "app.old");
        deleteTree(old);
        if (dir.exists() && !dir.renameTo(old)) throw new IOException("não consegui substituir " + dir);
        if (!tmp.renameTo(dir)) throw new IOException("não consegui criar " + dir);
        deleteTree(old);
        return dir;
    }

    /** Desembrulha um zip para `out`; `only` (ex.: {"data/", "meta/"}) limita as pastas aceites. Nada sai de `out`. */
    static void unzip(InputStream raw, File out, String[] only) throws IOException {
        String root = out.getCanonicalPath() + File.separator;
        byte[] buf = new byte[1 << 16];
        try (ZipInputStream z = new ZipInputStream(new BufferedInputStream(raw))) {
            for (ZipEntry e; (e = z.getNextEntry()) != null; ) {
                String n = e.getName();
                if (only != null) {
                    boolean ok = false;
                    for (String o : only) ok |= n.startsWith(o);
                    if (!ok) continue;
                }
                File f = new File(out, n);
                if (!f.getCanonicalPath().startsWith(root)) throw new IOException("caminho inválido no zip: " + n);
                if (e.isDirectory()) { f.mkdirs(); continue; }
                f.getParentFile().mkdirs();
                try (OutputStream o = new FileOutputStream(f)) {
                    for (int r; (r = z.read(buf)) > 0; ) o.write(buf, 0, r);
                }
            }
        }
    }

    static String read(File f) {
        try (InputStream in = new java.io.FileInputStream(f)) {
            byte[] b = new byte[(int) Math.min(f.length(), 4096)];
            int n = in.read(b);
            return n > 0 ? new String(b, 0, n, "UTF-8").trim() : "";
        } catch (IOException e) {
            return null;
        }
    }

    static void write(File f, String s) throws IOException {
        try (OutputStream o = new FileOutputStream(f)) { o.write(s.getBytes("UTF-8")); }
    }

    static void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.isDirectory() ? f.listFiles() : null;
        if (kids != null) for (File k : kids) deleteTree(k);
        f.delete();
    }
}
