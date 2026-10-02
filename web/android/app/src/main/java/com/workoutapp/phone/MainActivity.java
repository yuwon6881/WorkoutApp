package com.workoutapp.phone;

import android.content.Intent;
import android.os.Bundle;
import android.net.Uri;
import android.webkit.WebResourceResponse;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.CapConfig;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    static final String EXTRA_WORKOUT_ID = "workout_id";
    static final String EXTRA_RETRY = "retry_webview";

    @Override
    protected void load() {
        CapConfig nativeConfig = CapConfig.loadDefault(this);
        WebView view = findViewById(com.getcapacitor.android.R.id.webview);
        NativeShellUpgrade.install(this, view, nativeConfig.getAndroidScheme() + "://" + nativeConfig.getHostname());
        super.load();
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WorkoutPlugin.class);
        super.onCreate(savedInstanceState);
        // Match the configured origin so APIs bypass the APK asset server, as in Nutrition.
        final String appHost = Uri.parse(getBridge().getLocalUrl()).getHost();
        getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String path = uri.getPath();
                if ("https".equalsIgnoreCase(uri.getScheme()) && appHost.equalsIgnoreCase(uri.getHost()) &&
                    path != null && (path.equals("/api") || path.startsWith("/api/") || path.equals("/health"))) return null;
                return super.shouldInterceptRequest(view, request);
            }
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request.isForMainFrame() && WorkoutOfflineRecoveryActivity.hasSavedWorkout(MainActivity.this)) {
                    startActivity(new Intent(MainActivity.this, WorkoutOfflineRecoveryActivity.class));
                }
            }
        });
    }

    /// A tap on the workout notification while the app is open goes straight to that workout; on
    /// a cold start the app already reopens the saved workout by itself.
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (getBridge() != null && intent.getBooleanExtra(EXTRA_RETRY, false)) {
            getBridge().getWebView().post(() -> getBridge().getWebView().reload());
            return;
        }
        String workoutId = intent.getStringExtra(EXTRA_WORKOUT_ID);
        if (workoutId == null || workoutId.isEmpty() || getBridge() == null) return;
        String script = "window.location.assign('/?workout=' + encodeURIComponent(" + JSONObject.quote(workoutId) + "))";
        getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(script, null));
    }
}
