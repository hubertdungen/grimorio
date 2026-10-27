package com.hubertdungen.grimorio;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import java.io.File;

/**
 * Grimório para Android: o teu servidor do Grimório numa janela própria (sem barra do browser). Na primeira vez pede o
 * endereço (ex.: https://grimorio.exemplo.com ou http://192.168.1.10:8107); muda-se nas Definições do Grimório.
 * Câmara ao vivo (ler cartas), fotos e imagens, transferências (proxies) e ecrã inteiro.
 */
public class MainActivity extends Activity {
    private static final int CAM = 1, FILES = 2;
    private WebView web;
    private FrameLayout root;
    private View fullView;
    private PermissionRequest pendingPerm;
    private ValueCallback<Uri[]> pendingFiles;
    private Uri photo;
    private SharedPreferences prefs;
    private WebChromeClient chrome;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("grimorio", MODE_PRIVATE);
        root = new FrameLayout(this);
        web = new WebView(this);
        root.addView(web);
        setContentView(root);

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
            public void onReceivedError(WebView v, int code, String desc, String url) {
                if (url != null && url.equals(server())) askServer(getString(android.R.string.dialog_alert_title) + ": " + desc);
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
            public void onShowCustomView(View v, CustomViewCallback cb) { fullView = v; root.addView(v); web.setVisibility(View.GONE); immersive(true); }

            @Override
            public void onHideCustomView() { if (fullView != null) root.removeView(fullView); fullView = null; web.setVisibility(View.VISIBLE); immersive(false); }
        });

        web.setDownloadListener((url, ua, disp, mime, len) -> {  // proxies (ZIP/PDF), cópias .grimorio
            if (url.startsWith("blob:") || url.startsWith("data:")) return;  // esses vêm pelo GrimorioApp.saveFile (main.jsx)
            DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url))
                .addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url))
                .addRequestHeader("User-Agent", ua)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, URLUtil.guessFileName(url, disp, mime));
            ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(r);
        });

        if (state != null) web.restoreState(state);
        else if (server().isEmpty()) askServer(null);
        else web.loadUrl(server());
    }

    private String server() { return prefs.getString("server", ""); }

    /** Pede (ou muda) o endereço do servidor do Grimório. */
    void askServer(String why) {
        EditText in = new EditText(this);
        in.setHint("https://grimorio.exemplo.com");
        in.setText(server().isEmpty() ? "https://" : server());
        in.setSingleLine(true);
        new AlertDialog.Builder(this)
            .setTitle("Grimório")
            .setMessage((why != null ? why + "\n\n" : "") + "Endereço do teu servidor do Grimório (o que abres no browser):")
            .setView(in)
            .setCancelable(!server().isEmpty())
            .setPositiveButton(android.R.string.ok, (d, w) -> {
                String u = in.getText().toString().trim();
                if (!u.matches("(?i)^https?://.+")) u = "https://" + u.replaceFirst("^/+", "");
                if (!u.endsWith("/")) u += "/";
                prefs.edit().putString("server", u).apply();
                web.loadUrl(u);
            })
            .show();
    }

    private void immersive(boolean on) {
        if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
    }

    /** window.GrimorioApp no Grimório: mudar de servidor e saber a versão da app. */
    class Bridge {
        @JavascriptInterface public void changeServer() { runOnUiThread(() -> askServer(null)); }
        @JavascriptInterface public String version() { return BuildConfigVersion.name(MainActivity.this); }
        /** Ficheiros feitos no browser (PDF e ZIP dos proxies, cópias): ficam nas Transferências. */
        @JavascriptInterface public void saveFile(String name, String mime, String b64) {
            try {
                byte[] bytes = android.util.Base64.decode(b64, android.util.Base64.DEFAULT);
                String safe = name.replaceAll("[\\\\/:*?\"<>|]", "_");
                String where;
                if (android.os.Build.VERSION.SDK_INT >= 29) {
                    android.content.ContentValues v = new android.content.ContentValues();
                    v.put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, safe);
                    v.put(android.provider.MediaStore.MediaColumns.MIME_TYPE, mime);
                    v.put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    Uri u = getContentResolver().insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    try (java.io.OutputStream o = getContentResolver().openOutputStream(u)) { o.write(bytes); }
                    where = "Transferências/" + safe;
                } else {
                    File f = new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), safe);
                    try (java.io.FileOutputStream o = new java.io.FileOutputStream(f)) { o.write(bytes); }
                    where = f.getAbsolutePath();
                }
                String msg = "Guardado: " + where;
                runOnUiThread(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show());
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Não consegui guardar: " + e.getMessage(), Toast.LENGTH_LONG).show());
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
    public void onBackPressed() {
        if (fullView != null) { chrome.onHideCustomView(); return; }
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

    @Override
    protected void onPause() { super.onPause(); CookieManager.getInstance().flush(); }
}
