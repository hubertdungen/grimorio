package com.hubertdungen.grimorio;

import android.content.Context;

/** A versão da app (versionName), para o user-agent e para o Grimório mostrar. */
final class BuildConfigVersion {
    static String name(Context c) {
        try { return c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionName; } catch (Exception e) { return "?"; }
    }
}
