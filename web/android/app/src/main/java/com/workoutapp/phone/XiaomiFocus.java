package com.workoutapp.phone;

import android.content.Context;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import androidx.core.app.NotificationCompat;
import org.json.JSONException;
import org.json.JSONObject;

/// Xiaomi's HyperOS focus-notification format, which puts the workout and its rest countdown in
/// the Super Island (HyperOS 3) and the focus card and status-bar ticker (HyperOS 1 and 2). It is
/// Xiaomi's own JSON carried in the notification's extras; other phones ignore it, and a Xiaomi
/// phone that has not granted this app focus notifications shows the standard notification.
/// Island content is always generic, because the island shows on the lock screen and the
/// always-on display regardless of the lock-screen privacy setting.
///
/// The field layout follows Xiaomi's published push parameters (`param_v2`, `param_island`) and,
/// for the timer, the open-source HyperIsland ToolKit; Xiaomi does not document local timers.
final class XiaomiFocus {
    static final String STATUS_UNSUPPORTED = "unsupported";
    static final String STATUS_OFF = "off";
    static final String STATUS_ON = "on";

    static final String EXTRA_PARAM = "miui.focus.param";
    static final String EXTRA_PICS = "miui.focus.pics";
    static final String PIC_REST = "miui.focus.pic_rest";
    private static final String ACCENT = "#E6B450";
    // Countdown and count-up timer types in Xiaomi's timerInfo.
    private static final int TIMER_COUNTDOWN = -1;
    private static final int TIMER_COUNT_UP = 1;
    // Asking HyperOS for the permission is a cross-process call; the notification redraws every
    // few seconds during a rest, so the answer is reused briefly.
    private static final long PERMISSION_CACHE_MS = 60_000L;
    private static volatile boolean cachedPermission;
    private static volatile long cachedAtMs;

    private XiaomiFocus() {}

    /// Whether this phone has focus notifications at all, and whether this app may use them.
    static String status(Context context) {
        if (protocolVersion(context) < 1) return STATUS_UNSUPPORTED;
        cachedAtMs = 0;
        return hasPermission(context) ? STATUS_ON : STATUS_OFF;
    }

    static void apply(Context context, NotificationCompat.Builder builder, RestSnapshot snapshot, long now) {
        if (snapshot == null || protocolVersion(context) < 1 || !hasPermission(context)) return;
        String param = param(snapshot, now);
        if (param == null) return;
        Bundle pics = new Bundle();
        pics.putParcelable(PIC_REST, Icon.createWithResource(context, R.drawable.ic_focus_rest));
        Bundle extras = new Bundle();
        extras.putString(EXTRA_PARAM, param);
        extras.putBundle(EXTRA_PICS, pics);
        builder.addExtras(extras);
    }

    /// 1 to 3 on HyperOS (3 adds the Super Island); 0 everywhere else.
    static int protocolVersion(Context context) {
        try {
            return Settings.System.getInt(context.getContentResolver(), "notification_focus_protocol", 0);
        } catch (RuntimeException e) {
            return 0;
        }
    }

    private static boolean hasPermission(Context context) {
        long now = System.currentTimeMillis();
        if (now - cachedAtMs < PERMISSION_CACHE_MS) return cachedPermission;
        boolean allowed;
        try {
            Bundle request = new Bundle();
            request.putString("package", context.getPackageName());
            Bundle result = context.getContentResolver().call(
                    Uri.parse("content://miui.statusbar.notification.public"), "canShowFocus", null, request);
            allowed = result != null && result.getBoolean("canShowFocus", false);
        } catch (RuntimeException e) {
            allowed = false;
        }
        cachedPermission = allowed;
        cachedAtMs = now;
        return allowed;
    }

    /// The focus JSON for the workout's current state: a live countdown while resting, the elapsed
    /// workout time while training, and plain text while paused.
    static String param(RestSnapshot snapshot, long now) {
        try {
            String title;
            String content = null;
            JSONObject timer = null;
            if (snapshot.isRunning() && snapshot.deadlineMs > now) {
                title = "Resting";
                timer = timer(TIMER_COUNTDOWN, snapshot.deadlineMs, snapshot.deadlineMs - now, now);
            } else if (snapshot.isPaused()) {
                title = "Rest paused";
                content = (snapshot.pausedRemainingMs + 999) / 1000 + " s left";
            } else if (snapshot.pausedAtMs > 0) {
                title = "Workout paused";
                content = "Return to the app to resume.";
            } else if (snapshot.startedAtMs > 0) {
                title = "Workout";
                long start = snapshot.startedAtMs + snapshot.pausedSeconds * 1000L;
                timer = timer(TIMER_COUNT_UP, start, Math.max(0, now - start), now);
            } else {
                title = "Workout in progress";
                content = "Return to the app to log your next set.";
            }

            JSONObject card = new JSONObject().put("title", title).put("picProfile", PIC_REST);
            if (timer != null) card.put("timerInfo", timer);
            else card.put("content", content);

            JSONObject left = new JSONObject().put("type", 1).put("picInfo", picture());
            JSONObject big = new JSONObject().put("imageTextInfoLeft", left);
            if (timer != null) {
                big.put("sameWidthDigitInfo", new JSONObject().put("timerInfo", timer).put("showHighlightColor", true));
            } else {
                left.put("textInfo", new JSONObject().put("title", title));
            }
            JSONObject island = new JSONObject()
                    .put("islandProperty", 1)
                    .put("highlightColor", ACCENT)
                    .put("bigIslandArea", big)
                    .put("smallIslandArea", new JSONObject().put("picInfo", picture()));

            JSONObject v2 = new JSONObject()
                    .put("protocol", 1)
                    .put("business", "workout")
                    .put("updatable", true)
                    // Redraws during a rest must not pop the island open each time.
                    .put("enableFloat", false)
                    .put("ticker", title)
                    .put("tickerPic", PIC_REST)
                    .put("aodTitle", title)
                    .put("aodPic", PIC_REST)
                    .put("chatInfo", card)
                    .put("param_island", island);
            return new JSONObject().put("param_v2", v2).toString();
        } catch (JSONException e) {
            return null;
        }
    }

    private static JSONObject picture() throws JSONException {
        return new JSONObject().put("type", 1).put("pic", PIC_REST);
    }

    private static JSONObject timer(int type, long when, long total, long now) throws JSONException {
        return new JSONObject()
                .put("timerType", type)
                .put("timerWhen", when)
                .put("timerTotal", total)
                .put("timerSystemCurrent", now);
    }
}
