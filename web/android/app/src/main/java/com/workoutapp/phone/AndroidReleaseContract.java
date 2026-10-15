package com.workoutapp.phone;

import java.net.URI;
import org.json.JSONException;
import org.json.JSONObject;

/** Strict metadata validation; destinations are always the app-owned repository and channel tag. */
final class AndroidReleaseContract {
    static final String REPOSITORY = "https://github.com/yuwon6881/WorkoutApp";
    static String releaseUrl(String channel) { return REPOSITORY + "/releases/tag/android-" + channel; }
    static String manifestUrl(String channel) { return REPOSITORY + "/releases/download/android-" + channel + "/android-release.json"; }

    static String validate(JSONObject metadata, String applicationId, String channel, long version, String certificate) throws JSONException {
        if (metadata.getInt("schemaVersion") != 1 || !applicationId.equals(metadata.getString("applicationId")) ||
                !channel.equals(metadata.getString("channel"))) throw new JSONException("incompatible_metadata");
        Object rawVersion = metadata.get("versionCode");
        if (!(rawVersion instanceof Number) || ((Number) rawVersion).doubleValue() != ((Number) rawVersion).longValue() ||
                ((Number) rawVersion).longValue() <= 0 || ((Number) rawVersion).longValue() > Integer.MAX_VALUE)
            throw new JSONException("invalid_version");
        String apk = metadata.getString("apkUrl");
        URI uri;
        try { uri = URI.create(apk); } catch (IllegalArgumentException failure) { throw new JSONException("invalid_destination"); }
        String prefix = REPOSITORY + "/releases/download/android-" + channel + "/";
        String name = apk.startsWith(prefix) ? apk.substring(prefix.length()) : "";
        if (!"https".equals(uri.getScheme()) || uri.getQuery() != null || uri.getFragment() != null ||
                !name.matches("[A-Za-z0-9._-]+\\.apk")) throw new JSONException("untrusted_destination");
        if (!metadata.getString("apkSha256").matches("(?i)[0-9a-f]{64}") ||
                !metadata.getString("signingCertificateSha256").matches("(?i)[0-9a-f]{64}")) throw new JSONException("invalid_digest");
        String nameValue = metadata.getString("versionName");
        if (nameValue.isEmpty() || nameValue.length() > 80 || nameValue.contains("\n")) throw new JSONException("invalid_version_name");
        String published = metadata.getString("publishedAt");
        if (!published.matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{3})?Z")) throw new JSONException("invalid_publication_time");
        java.text.SimpleDateFormat date = new java.text.SimpleDateFormat(published.contains(".") ? "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'" : "yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.ROOT);
        date.setLenient(false);
        java.text.ParsePosition position = new java.text.ParsePosition(0);
        if (date.parse(published, position) == null || position.getIndex() != published.length()) throw new JSONException("invalid_publication_time");
        if (!metadata.getString("signingCertificateSha256").equalsIgnoreCase(certificate)) return "incompatible";
        return metadata.getLong("versionCode") > version ? "available" : "up-to-date";
    }
}
