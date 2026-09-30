package com.workoutapp.phone;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    static final String EXTRA_WORKOUT_ID = "workout_id";
    static final String EXTRA_RETRY = "retry_webview";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WorkoutPlugin.class);
        super.onCreate(savedInstanceState);
        // The app loads its pages from the web origin. Without a connection the page cannot load,
        // so a workout saved on this phone opens in the bundled recovery screen instead of an
        // error page; nothing there changes or discards the saved work.
        getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
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
