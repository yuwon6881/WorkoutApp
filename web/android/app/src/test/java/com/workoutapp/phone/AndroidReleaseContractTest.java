package com.workoutapp.phone;

import static org.junit.Assert.*;
import org.json.JSONObject;
import org.junit.Test;

public class AndroidReleaseContractTest {
    private static final String CERT = "a".repeat(64);
    private JSONObject metadata() throws Exception {
        return new JSONObject().put("schemaVersion", 1).put("applicationId", "app").put("channel", "release")
                .put("versionCode", 20).put("versionName", "1.2").put("apkSha256", "b".repeat(64))
                .put("signingCertificateSha256", CERT).put("publishedAt", "2026-10-15T00:00:00.000Z")
                .put("apkUrl", AndroidReleaseContract.REPOSITORY + "/releases/download/android-release/app-release.apk");
    }
    @Test public void comparesIntegerBuildsAndSigningIdentity() throws Exception {
        assertEquals("available", AndroidReleaseContract.validate(metadata(), "app", "release", 19, CERT));
        assertEquals("up-to-date", AndroidReleaseContract.validate(metadata(), "app", "release", 20, CERT));
        assertEquals("up-to-date", AndroidReleaseContract.validate(metadata(), "app", "release", 21, CERT));
        assertEquals("incompatible", AndroidReleaseContract.validate(metadata(), "app", "release", 19, "c".repeat(64)));
    }
    @Test public void rejectsWrongApplicationsChannelsAndMalformedMetadata() throws Exception {
        assertThrows(Exception.class, () -> AndroidReleaseContract.validate(metadata(), "wrong", "release", 19, CERT));
        assertThrows(Exception.class, () -> AndroidReleaseContract.validate(metadata(), "app", "device-test", 19, CERT));
        assertThrows(Exception.class, () -> AndroidReleaseContract.validate(metadata().put("versionCode", 20.5), "app", "release", 19, CERT));
        assertThrows(Exception.class, () -> AndroidReleaseContract.validate(metadata().put("apkSha256", "bad"), "app", "release", 19, CERT));
        assertThrows(Exception.class, () -> AndroidReleaseContract.validate(metadata().put("publishedAt", "2026-99-99T00:00:00.000Z"), "app", "release", 19, CERT));
    }
    @Test public void rejectsUntrustedDownloadDestinations() throws Exception {
        for (String url : new String[]{"http://github.com/file.apk", "https://evil.example/file.apk",
                AndroidReleaseContract.REPOSITORY + "/releases/download/android-release/../file.apk",
                AndroidReleaseContract.REPOSITORY + "/releases/download/android-release/app.apk?redirect=evil"})
            assertThrows(Exception.class, () -> AndroidReleaseContract.validate(metadata().put("apkUrl", url), "app", "release", 19, CERT));
    }
}
