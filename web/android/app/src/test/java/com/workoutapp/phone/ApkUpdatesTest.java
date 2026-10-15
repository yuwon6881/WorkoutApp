package com.workoutapp.phone;

import static org.junit.Assert.*;
import android.content.Context;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class ApkUpdatesTest {
    private static final String CERT = "a".repeat(64);
    private String metadata() throws Exception {
        return new JSONObject().put("schemaVersion", 1).put("applicationId", BuildConfig.APPLICATION_ID)
                .put("channel", BuildConfig.DISTRIBUTION_CHANNEL).put("versionCode", BuildConfig.VERSION_CODE + 1)
                .put("versionName", "next").put("apkSha256", "b".repeat(64)).put("signingCertificateSha256", CERT)
                .put("publishedAt", "2026-10-15T00:00:00.000Z")
                .put("apkUrl", AndroidReleaseContract.REPOSITORY + "/releases/download/android-" + BuildConfig.DISTRIBUTION_CHANNEL + "/app.apk").toString();
    }
    @Test public void foregroundChecksOncePerDayAndManualOfflineChecksPreserveLastSuccess() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        long now = 1792022400000L;
        AtomicInteger requests = new AtomicInteger();
        ApkUpdates.MetadataSource source = url -> {
            requests.incrementAndGet();
            assertEquals(AndroidReleaseContract.manifestUrl(BuildConfig.DISTRIBUTION_CHANNEL), url);
            return metadata();
        };
        assertEquals("available", ApkUpdates.check(context, false, source, () -> CERT, now).getString("status"));
        assertEquals("available", ApkUpdates.check(context, false, source, () -> CERT, now + 1000).getString("status"));
        assertEquals(1, requests.get());
        JSONObject offline = ApkUpdates.check(context, true, url -> { throw new java.io.IOException("offline"); }, () -> CERT, now + 2000);
        assertEquals("unavailable", offline.getString("status"));
        assertEquals(now, offline.getLong("lastSuccessfulCheck"));
        ApkUpdates.check(context, false, source, () -> CERT, now + 24L * 60 * 60 * 1000);
        assertEquals(2, requests.get());
    }
    @Test public void malformedOrUnavailableMetadataNeverInventsACheckTime() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        JSONObject result = ApkUpdates.check(context, true, url -> "bad json", () -> CERT, 1000);
        assertEquals("unavailable", result.getString("status"));
        assertTrue(result.isNull("lastSuccessfulCheck"));
    }
}
