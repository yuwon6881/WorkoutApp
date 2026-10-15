package com.workoutapp.phone;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import com.getcapacitor.JSObject;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import org.json.JSONObject;

final class ApkUpdates {
    interface MetadataSource { String fetch(String url) throws Exception; }
    interface InstalledCertificate { String read() throws Exception; }
    static synchronized JSObject check(Context context, boolean manual) {
        return check(context, manual, ReleaseMetadataHttp::fetch, () -> certificate(context), System.currentTimeMillis());
    }

    static synchronized JSObject check(Context context, boolean manual, MetadataSource source, InstalledCertificate signer, long now) {
        SharedPreferences cache = context.getSharedPreferences("apk-updates", Context.MODE_PRIVATE);
        String day = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(new Date(now));
        if (!manual && cache.getInt("installedVersion", -1) == BuildConfig.VERSION_CODE && day.equals(cache.getString("attemptDay", ""))) {
            try { return new JSObject(cache.getString("lastResult", "{}")); }
            catch (Exception invalid) { /* Retry invalid local metadata. */ }
        }
        JSObject result = new JSObject();
        long lastSuccess = cache.getLong("lastSuccess", 0);
        try {
            JSONObject metadata = new JSONObject(source.fetch(AndroidReleaseContract.manifestUrl(BuildConfig.DISTRIBUTION_CHANNEL)));
            String status = AndroidReleaseContract.validate(metadata, BuildConfig.APPLICATION_ID, BuildConfig.DISTRIBUTION_CHANNEL,
                    BuildConfig.VERSION_CODE, signer.read());
            result.put("status", status);
            result.put("versionName", metadata.getString("versionName"));
            result.put("releaseUrl", AndroidReleaseContract.releaseUrl(BuildConfig.DISTRIBUTION_CHANNEL));
            lastSuccess = now;
        } catch (Exception failure) { result.put("status", "unavailable"); }
        result.put("lastSuccessfulCheck", lastSuccess > 0 ? lastSuccess : JSONObject.NULL);
        cache.edit().putString("attemptDay", day).putInt("installedVersion", BuildConfig.VERSION_CODE)
                .putLong("lastSuccess", lastSuccess).putString("lastResult", result.toString()).apply();
        return result;
    }

    private static String certificate(Context context) throws Exception {
        PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(),
                Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES);
        Signature[] signatures = Build.VERSION.SDK_INT >= 28 ? info.signingInfo.getApkContentsSigners() : info.signatures;
        if (signatures == null || signatures.length != 1) throw new IllegalStateException("signing_identity_unavailable");
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray());
        StringBuilder hex = new StringBuilder();
        for (byte value : digest) hex.append(String.format(Locale.ROOT, "%02x", value & 255));
        return hex.toString();
    }
}
