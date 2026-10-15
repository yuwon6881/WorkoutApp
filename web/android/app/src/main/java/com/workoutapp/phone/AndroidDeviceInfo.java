package com.workoutapp.phone;

import android.app.Activity;
import android.content.pm.PackageInfo;
import android.os.Build;
import androidx.webkit.WebViewCompat;
import com.getcapacitor.JSObject;
import org.json.JSONObject;

final class AndroidDeviceInfo {
    static JSObject read(Activity activity) {
        JSObject info = new JSObject();
        info.put("version", BuildConfig.VERSION_NAME);
        info.put("build", BuildConfig.VERSION_CODE);
        info.put("channel", BuildConfig.DISTRIBUTION_CHANNEL);
        info.put("android", Build.VERSION.RELEASE);
        info.put("sdk", Build.VERSION.SDK_INT);
        PackageInfo webview = WebViewCompat.getCurrentWebViewPackage(activity);
        info.put("webview", webview == null ? JSONObject.NULL : webview.versionName);
        String error = activity.getPreferences(Activity.MODE_PRIVATE).getString("recovery_error", null);
        info.put("recoveryError", "renderer_terminated".equals(error) || "rest_action_save_failed".equals(error) ? error : JSONObject.NULL);
        return info;
    }
}
