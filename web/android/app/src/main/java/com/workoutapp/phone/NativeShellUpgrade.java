package com.workoutapp.phone;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.net.Uri;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.webkit.ScriptHandler;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.util.Collections;

/** Runs before either an old worker's page or the packaged page can accept interaction. */
final class NativeShellUpgrade {
    private static final String PREFERENCES = "workout-shell-upgrade";
    private static final String COMPLETE = "packaged-ui-v1";

    static void install(Activity activity, WebView view, String origin) {
        if (activity.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getBoolean(COMPLETE, false)
                || !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return;
        Migration migration = new Migration(activity, view, origin);
        view.addJavascriptInterface(migration, "WorkoutShellUpgrade");
        migration.script = WebViewCompat.addDocumentStartJavaScript(view, SCRIPT, Collections.singleton(origin));
    }

    static final String SCRIPT = "(() => { window.stop(); let settled = false;"
        + "const done = ok => { if (!settled) { settled = true; WorkoutShellUpgrade.complete(ok); } };"
        + "const deadline = setTimeout(() => done(false), 2000);"
        + "(async () => { if ('serviceWorker' in navigator) {"
        + "const registrations = await navigator.serviceWorker.getRegistrations();"
        + "const owned = registrations.filter(r => [r.active,r.waiting,r.installing].some(w => w && w.scriptURL === new URL('/sw.js',location.origin).href));"
        + "await Promise.all(owned.map(r => r.unregister())); }"
        + "if ('caches' in window) { const names = await caches.keys();"
        + "await Promise.all(names.filter(n => n.startsWith('workbox-precache-') && n.endsWith(location.origin + '/')).map(n => caches.delete(n))); }"
        + "clearTimeout(deadline); done(true); })().catch(() => { clearTimeout(deadline); done(false); }); })();";

    private static final class Migration {
        private final Activity activity;
        private final WebView view;
        private final String origin;
        private ScriptHandler script;

        Migration(Activity activity, WebView view, String origin) {
            this.activity = activity; this.view = view; this.origin = origin;
        }

        @JavascriptInterface
        public void complete(boolean successful) {
            view.post(() -> {
                Uri current = Uri.parse(view.getUrl() == null ? "" : view.getUrl());
                if (!origin.equals(current.getScheme() + "://" + current.getAuthority())) return;
                if (successful) {
                    activity.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().putBoolean(COMPLETE, true).apply();
                    if (script != null) script.remove();
                    view.removeJavascriptInterface("WorkoutShellUpgrade");
                    view.reload();
                } else {
                    new AlertDialog.Builder(activity).setTitle("Finish updating Workout")
                        .setMessage("The app could not retire its previous web shell. Your saved workouts are unchanged.")
                        .setPositiveButton("Retry", (dialog, which) -> view.reload()).setCancelable(false).show();
                }
            });
        }
    }
}
