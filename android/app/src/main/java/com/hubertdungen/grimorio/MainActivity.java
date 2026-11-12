package com.hubertdungen.grimorio;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Grimório para Android. Por omissão corre tudo neste aparelho: o servidor do Grimório (server.py, Python embutido pelo
 * Chaquopy) em http://127.0.0.1:&lt;porta&gt; com os dados privados da app (LocalServer), e na primeira vez descarrega os
 * dados das cartas (CardData). Quem tem um servidor do Grimório pode ligar a app a ele (modo «remote», como as versões
 * antigas da app); muda-se nas Definições do Grimório (window.GrimorioApp) ou no ecrã inicial.
 * Câmara ao vivo (ler cartas), fotos e imagens, transferências (proxies, cópias) e ecrã inteiro.
 */
public class MainActivity extends Activity {
    private static final int CAM = 1, FILES = 2;
    static final String LOCAL = "local", REMOTE = "remote";
    private WebView web;
    private FrameLayout root;
    private View fullView;
    private PermissionRequest pendingPerm;
    private ValueCallback<Uri[]> pendingFiles;
    private Uri photo;
    private SharedPreferences prefs;
    private WebChromeClient chrome;
    private Bundle saved;           // estado da WebView para repor quando o servidor local estiver pronto
    private boolean booting, clearHistory;
    // ecrã de arranque (dados das cartas, a abrir, erros)
    private ScrollView setup;
    private TextView setupMsg;
    private ProgressBar setupBar;
    private Button setupMain, setupAlt;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("grimorio", MODE_PRIVATE);
        // quem já usava a app com um servidor continua nele; uma instalação nova corre neste aparelho
        if (!prefs.contains("mode")) prefs.edit().putString("mode", server().isEmpty() ? LOCAL : REMOTE).apply();
        root = new FrameLayout(this);
        web = new WebView(this);
        root.addView(web);
        root.addView(setup = buildSetup());
        root.setBackgroundColor(0xFF0D0F18);
        setContentView(root);
        if (android.os.Build.VERSION.SDK_INT >= 35) {
            // Android 15+ desenha a app por baixo das barras do sistema (targetSdk 35+): a página fica entre elas e acima
            // do teclado, como antes
            root.setOnApplyWindowInsetsListener((v, ins) -> {
                android.graphics.Insets b = ins.getInsets(android.view.WindowInsets.Type.systemBars()
                    | android.view.WindowInsets.Type.displayCutout() | android.view.WindowInsets.Type.ime());
                if (fullView != null) v.setPadding(0, 0, 0, 0);  // vídeo em ecrã inteiro
                else v.setPadding(b.left, b.top, b.right, b.bottom);
                return android.view.WindowInsets.CONSUMED;
            });
        }
        if (android.os.Build.VERSION.SDK_INT >= 33)  // Android 16 (targetSdk 36) já não chama o onBackPressed
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::back);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " GrimorioAndroid/" + BuildConfigVersion.name(this));
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        web.addJavascriptInterface(new Bridge(), "GrimorioApp");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                String scheme = u.getScheme();
                if ("http".equals(scheme) || "https".equals(scheme)) return false;  // o servidor e o login (Authelia) ficam aqui
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                if (clearHistory) { clearHistory = false; v.clearHistory(); }  // mudou de modo: o «voltar» não regressa ao outro
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                String url = r.getUrl().toString(), base = base();
                if (!r.isForMainFrame() || base.isEmpty() || !url.startsWith(base)) return;
                String why = String.valueOf(e.getDescription());
                if (REMOTE.equals(mode())) askServer(getString(R.string.server_unreachable, why));
                else showSetup(getString(R.string.setup_error, why), false, R.string.retry, () -> bootLocal(), true);
            }
        });

        web.setWebChromeClient(chrome = new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest req) {  // câmara ao vivo (getUserMedia) do «Ler carta»
                runOnUiThread(() -> {
                    if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) req.grant(req.getResources());
                    else { pendingPerm = req; requestPermissions(new String[]{Manifest.permission.CAMERA}, CAM); }
                });
            }

            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {  // foto ou imagem
                if (pendingFiles != null) pendingFiles.onReceiveValue(null);
                pendingFiles = cb;
                Intent pick = params.createIntent();
                Intent chooser = Intent.createChooser(pick, null);
                try {
                    File dir = new File(getCacheDir(), "fotos");
                    dir.mkdirs();
                    File f = File.createTempFile("carta", ".jpg", dir);
                    photo = FileProvider.getUriForFile(MainActivity.this, "com.hubertdungen.grimorio.files", f);
                    Intent cam = new Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE).putExtra(android.provider.MediaStore.EXTRA_OUTPUT, photo)
                        .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                    // com «capture» (Tirar foto) abre logo a câmara; senão, a câmara aparece ao lado da galeria
                    if (params.isCaptureEnabled()) chooser = cam;
                    else chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{cam});
                } catch (Exception e) { photo = null; }
                try { startActivityForResult(chooser, FILES); } catch (Exception e) { pendingFiles = null; return false; }
                return true;
            }

            @Override
            public void onShowCustomView(View v, CustomViewCallback cb) { fullView = v; root.addView(v); web.setVisibility(View.GONE); immersive(true); root.requestApplyInsets(); }

            @Override
            public void onHideCustomView() { if (fullView != null) root.removeView(fullView); fullView = null; web.setVisibility(View.VISIBLE); immersive(false); root.requestApplyInsets(); }
        });

        web.setDownloadListener((url, ua, disp, mime, len) -> {  // proxies (ZIP/PDF), cópias .grimorio
            if (url.startsWith("blob:") || url.startsWith("data:")) return;  // esses vêm pelo GrimorioApp.saveFile (main.jsx)
            String name = URLUtil.guessFileName(url, disp, mime);
            if (LocalServer.running() && url.startsWith(LocalServer.url())) {  // do servidor deste aparelho: a app grava-o
                new Thread(() -> download(url, name, mime)).start();
                return;
            }
            DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url))
                .addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url))
                .addRequestHeader("User-Agent", ua)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(r);
        });

        pendingJoin = joinHash(getIntent());
        saved = pendingJoin.isEmpty() ? state : null;
        open();
    }

    /** Abre o Grimório no modo escolhido: neste aparelho (arranca o servidor local) ou no servidor guardado. */
    private void open() {
        if (LOCAL.equals(mode())) { bootLocal(); return; }
        hideSetup();
        if (server().isEmpty()) { askServer(null); return; }
        if (saved != null) { web.restoreState(saved); saved = null; return; }
        web.loadUrl(server() + pendingJoin);
        pendingJoin = "";
    }

    String mode() { return prefs.getString("mode", LOCAL); }

    private String server() { return prefs.getString("server", ""); }

    /** O endereço do Grimório que a WebView deve mostrar agora ('' se o local ainda não arrancou). */
    private String base() { return LOCAL.equals(mode()) ? (LocalServer.running() ? LocalServer.url() : "") : server(); }

    /** A página aberta é o Grimório desta app (o local ou o servidor guardado), e não um site que se abriu por um link. */
    private boolean trusted() {
        String u = web.getUrl(), b = base();
        return u != null && !b.isEmpty() && u.startsWith(b);
    }

    // ---------- modo local: dados das cartas e servidor neste aparelho ----------

    private void bootLocal() {
        if (booting) return;
        File d = LocalServer.dataDir(this);
        String ver = BuildConfigVersion.name(this);
        if (!CardData.have(d)) {
            boolean metered = metered();
            // em Wi-Fi descarrega logo; em dados móveis pergunta antes (≈ 11 MB)
            showSetup(getString(R.string.setup_first) + (metered ? "\n\n" + getString(R.string.setup_metered) : ""), false,
                R.string.setup_download, this::downloadData, true);
            if (!metered) downloadData();
            return;
        }
        startLocal();
        if (CardData.outdated(d, ver) && !metered()) {  // app nova: os dados novos vêm por trás; os de agora servem até lá
            new Thread(() -> {
                try {
                    CardData.install(d, ver, null, null);
                    runOnUiThread(() -> Toast.makeText(this, R.string.data_updated, Toast.LENGTH_SHORT).show());
                } catch (Exception e) {
                    android.util.Log.w("Grimorio", "dados das cartas por atualizar", e);
                }
            }).start();
        }
    }

    private void downloadData() {
        if (booting) return;
        booting = true;
        showSetup(getString(R.string.setup_downloading, ""), true, 0, null, false);
        File d = LocalServer.dataDir(this);
        d.mkdirs();
        new Thread(() -> {
            try {
                CardData.install(d, BuildConfigVersion.name(this), (done, total) -> runOnUiThread(() -> {
                    String mb = (done >> 20) + (total > 0 ? " / " + (total >> 20) : "") + " MB";
                    setupMsg.setText(getString(R.string.setup_downloading, mb));
                    setupBar.setIndeterminate(total <= 0);
                    if (total > 0) setupBar.setProgress((int) (1000 * done / total));
                }), null);
                runOnUiThread(() -> { booting = false; startLocal(); });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    booting = false;
                    showSetup(getString(R.string.setup_error, String.valueOf(e.getMessage())) + "\n\n" + getString(R.string.setup_resume),
                        false, R.string.retry, this::downloadData, true);
                });
            }
        }).start();
    }

    private void startLocal() {
        if (LocalServer.running()) { loadLocal(); return; }
        if (booting) return;
        booting = true;
        showSetup(getString(R.string.setup_starting), true, 0, null, false);
        setupBar.setIndeterminate(true);
        new Thread(() -> {
            try {
                LocalServer.start(getApplicationContext(), prefs);
                runOnUiThread(() -> { booting = false; loadLocal(); });
            } catch (Exception e) {
                android.util.Log.e("Grimorio", "servidor local", e);
                runOnUiThread(() -> {
                    booting = false;
                    showSetup(getString(R.string.setup_error, String.valueOf(e.getMessage())), false, R.string.retry, this::startLocal, true);
                });
            }
        }).start();
    }

    /** O cookie da app (o servidor local só responde a ele) e depois a página. */
    private void loadLocal() {
        if (!LOCAL.equals(mode())) return;  // mudou para um servidor enquanto arrancava
        String url = LocalServer.url();
        CookieManager.getInstance().setCookie(url, "grimorio_app=" + LocalServer.token(prefs) + "; Path=/; SameSite=Lax", ok -> {
            hideSetup();
            if (saved != null && pendingJoin.isEmpty() && web.restoreState(saved) != null) { saved = null; return; }
            saved = null;
            web.loadUrl(url + pendingJoin);
            pendingJoin = "";
        });
    }

    private boolean metered() {
        try { return ((ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE)).isActiveNetworkMetered(); } catch (Exception e) { return false; }
    }

    /** Muda de modo: "local" (neste aparelho) ou "remote" com o endereço do servidor ('' pergunta-o). */
    void setMode(String m, String url) {
        if (REMOTE.equals(m)) {
            String u = normalize(url);
            if (u == null) { askServer(null); return; }
            prefs.edit().putString("server", u).putString("mode", REMOTE).apply();
        } else {
            prefs.edit().putString("mode", LOCAL).apply();  // o endereço do servidor fica guardado para voltar a ele
        }
        clearHistory = true;
        saved = null;
        open();
    }

    static String normalize(String url) {
        String u = url == null ? "" : url.trim();
        if (u.isEmpty() || u.equals("https://") || u.equals("http://")) return null;
        if (!u.matches("(?i)^https?://.+")) u = "https://" + u.replaceFirst("^/+", "");
        if (!u.endsWith("/")) u += "/";
        return u;
    }

    // ---------- ecrã de arranque ----------

    private ScrollView buildSetup() {
        float dp = getResources().getDisplayMetrics().density;
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_HORIZONTAL);
        int pad = (int) (24 * dp);
        col.setPadding(pad, pad * 2, pad, pad);
        TextView title = new TextView(this);
        title.setText(R.string.app_name);
        title.setTextColor(Color.WHITE);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 28);
        title.setGravity(Gravity.CENTER);
        col.addView(title);
        setupMsg = new TextView(this);
        setupMsg.setTextColor(0xFFC9C6DA);
        setupMsg.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        setupMsg.setGravity(Gravity.CENTER);
        setupMsg.setPadding(0, pad, 0, pad);
        col.addView(setupMsg);
        setupBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        setupBar.setMax(1000);
        col.addView(setupBar, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        setupMain = new Button(this);
        col.addView(setupMain);
        setupAlt = new Button(this, null, android.R.attr.borderlessButtonStyle);
        setupAlt.setText(R.string.use_server);
        setupAlt.setTextColor(0xFFA996FF);
        setupAlt.setAllCaps(false);
        setupAlt.setOnClickListener(v -> askServer(null));
        col.addView(setupAlt);
        ScrollView sv = new ScrollView(this);
        sv.setFillViewport(true);
        sv.setBackgroundColor(0xFF0D0F18);
        sv.addView(col);
        sv.setVisibility(View.GONE);
        return sv;
    }

    /** msg; barra de progresso; botão principal (0 = nenhum); o link «Ligar a um servidor». */
    private void showSetup(String msg, boolean progress, int button, Runnable action, boolean alt) {
        setup.setVisibility(View.VISIBLE);
        setupMsg.setText(msg);
        setupBar.setVisibility(progress ? View.VISIBLE : View.GONE);
        setupBar.setIndeterminate(true);
        setupMain.setVisibility(button != 0 ? View.VISIBLE : View.GONE);
        if (button != 0) { setupMain.setText(button); setupMain.setOnClickListener(v -> action.run()); }
        setupAlt.setVisibility(alt ? View.VISIBLE : View.GONE);
    }

    private void hideSetup() { setup.setVisibility(View.GONE); }

    /** grimorio://join?u=<link de um amigo> -> "#levar=<link>": o Grimório abre «Sala de um amigo». */
    private String pendingJoin = "";
    static String joinHash(Intent i) {
        Uri d = i == null ? null : i.getData();
        if (d == null || !"grimorio".equals(d.getScheme())) return "";
        String u = d.getQueryParameter("u");
        if (u == null || !u.matches("(?i)^https?://\\S{1,590}$")) return "";
        return "#levar=" + Uri.encode(u);
    }

    @Override
    protected void onNewIntent(Intent i) {  // singleTask: a app já estava aberta
        super.onNewIntent(i);
        setIntent(i);
        String jh = joinHash(i);
        if (jh.isEmpty()) return;
        String b = base();
        if (b.isEmpty()) { pendingJoin = jh; if (REMOTE.equals(mode())) askServer(null); }
        else web.loadUrl(b + jh);
    }

    /** Pede (ou muda) o endereço do servidor do Grimório; «Usar só neste aparelho» volta ao modo local. */
    void askServer(String why) {
        EditText in = new EditText(this);
        in.setHint("https://grimorio.exemplo.com");
        in.setText(server().isEmpty() ? "https://" : server());
        in.setSingleLine(true);
        new AlertDialog.Builder(this)
            .setTitle(R.string.app_name)
            .setMessage((why != null ? why + "\n\n" : "") + getString(R.string.server_ask))
            .setView(in)
            .setPositiveButton(android.R.string.ok, (d, w) -> setMode(REMOTE, in.getText().toString()))
            .setNeutralButton(R.string.use_local, (d, w) -> setMode(LOCAL, null))
            .setNegativeButton(android.R.string.cancel, null)
            .show();
    }

    private void immersive(boolean on) {
        if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
    }

    /** Uma transferência do servidor deste aparelho (o DownloadManager do sistema não leva o cookie da app a 127.0.0.1). */
    private void download(String url, String name, String mime) {
        HttpURLConnection h = null;
        try {
            h = (HttpURLConnection) new URL(url).openConnection();
            h.setRequestProperty("Cookie", CookieManager.getInstance().getCookie(url));
            try (InputStream in = h.getInputStream()) { save(name, h.getContentType() != null ? h.getContentType() : mime, in); }
        } catch (Exception e) {
            toast(getString(R.string.save_failed, String.valueOf(e.getMessage())));
        } finally {
            if (h != null) h.disconnect();
        }
    }

    /** Grava nas Transferências do aparelho e avisa. */
    private void save(String name, String mime, InputStream in) throws Exception {
        String safe = name.replaceAll("[\\\\/:*?\"<>|]", "_"), where;
        OutputStream o;
        if (android.os.Build.VERSION.SDK_INT >= 29) {
            android.content.ContentValues v = new android.content.ContentValues();
            v.put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, safe);
            v.put(android.provider.MediaStore.MediaColumns.MIME_TYPE, mime);
            v.put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
            Uri u = getContentResolver().insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            o = getContentResolver().openOutputStream(u);
            where = getString(R.string.downloads) + "/" + safe;
        } else {
            File f = new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), safe);
            o = new java.io.FileOutputStream(f);
            where = f.getAbsolutePath();
        }
        try (OutputStream out = o) {
            byte[] buf = new byte[1 << 16];
            for (int r; (r = in.read(buf)) > 0; ) out.write(buf, 0, r);
        }
        toast(getString(R.string.saved, where));
    }

    private void toast(String msg) { runOnUiThread(() -> Toast.makeText(this, msg, Toast.LENGTH_LONG).show()); }

    /**
     * window.GrimorioApp no Grimório (o contrato está em docs/ROADMAP.md › Android):
     * getMode() "local"|"remote" · getServer() o endereço guardado · setMode(mode, url) muda (e recarrega) ·
     * changeServer() pede o endereço · version() · saveFile · keepScreenOn · orientation.
     */
    class Bridge {
        @JavascriptInterface public String getMode() { return mode(); }
        @JavascriptInterface public String getServer() { return server(); }
        @JavascriptInterface public void setMode(String m, String url) {
            runOnUiThread(() -> { if (trusted()) MainActivity.this.setMode(REMOTE.equals(m) ? REMOTE : LOCAL, url); });
        }
        @JavascriptInterface public void changeServer() { runOnUiThread(() -> { if (trusted()) askServer(null); }); }
        // «⟳ rodar» do Forge Play: roda o ecrã mesmo com a rotação automática do Android desligada ("auto" volta ao normal)
        @JavascriptInterface public void orientation(String o) {
            final int v = "landscape".equals(o) ? android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                : "portrait".equals(o) ? android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT : android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
            runOnUiThread(() -> setRequestedOrientation(v));
        }
        @JavascriptInterface public String version() { return BuildConfigVersion.name(MainActivity.this); }
        /** Ficheiros feitos no browser (PDF e ZIP dos proxies, cópias): ficam nas Transferências. */
        @JavascriptInterface public void saveFile(String name, String mime, String b64) {
            try {
                save(name, mime, new ByteArrayInputStream(android.util.Base64.decode(b64, android.util.Base64.DEFAULT)));
            } catch (Exception e) {
                toast(getString(R.string.save_failed, String.valueOf(e.getMessage())));
            }
        }
        @JavascriptInterface public void keepScreenOn(boolean on) {
            runOnUiThread(() -> { if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); });
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        if (code == CAM && pendingPerm != null) {
            if (res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED) pendingPerm.grant(pendingPerm.getResources());
            else pendingPerm.deny();
            pendingPerm = null;
        }
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        if (code != FILES || pendingFiles == null) { super.onActivityResult(code, result, data); return; }
        Uri[] out = null;
        if (result == RESULT_OK) {
            if (data != null && (data.getData() != null || data.getClipData() != null)) out = WebChromeClient.FileChooserParams.parseResult(result, data);
            else if (photo != null) out = new Uri[]{photo};  // a foto tirada com a câmara
        }
        pendingFiles.onReceiveValue(out);
        pendingFiles = null;
    }

    @Override
    public void onBackPressed() { back(); }  // Android 12 e anteriores

    private void back() {
        if (fullView != null) { chrome.onHideCustomView(); return; }
        if (setup.getVisibility() != View.VISIBLE && web.canGoBack()) web.goBack();
        else finish();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

    @Override
    protected void onPause() { super.onPause(); CookieManager.getInstance().flush(); away(true); }

    @Override
    protected void onResume() { super.onResume(); away(false); }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        // saiu da app (não é só rodar o ecrã): o servidor deste aparelho pára e o processo acaba, para a próxima vez
        // arrancar limpo (o Python só arranca o server.py uma vez por processo)
        if (isFinishing() && LocalServer.running()) {
            LocalServer.stop();
            android.os.Process.killProcess(android.os.Process.myPid());
        }
    }

    // a app foi para segundo plano / voltou: a página sabe (o relógio de torneio do Forge Play pausa fora da mesa)
    private void away(boolean on) {
        if (web != null) web.evaluateJavascript("window.__grimAway=" + on + ";window.dispatchEvent(new Event('grimorio:away'))", null);
    }
}
