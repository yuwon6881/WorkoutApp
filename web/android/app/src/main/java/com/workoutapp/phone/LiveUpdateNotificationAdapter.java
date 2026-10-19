package com.workoutapp.phone;

import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

/// The ongoing workout notification: elapsed time while training, the rest countdown while
/// resting, and a paused state, all counted by the system chronometer rather than by the page.
/// While a rest runs it carries −30 s, +30 s, and Skip buttons and a bar showing how much of the
/// rest has passed. The next set appears only in the private version; the version Android shows
/// on a locked screen that hides sensitive content stays generic. On Android versions with Live
/// Updates it asks to be promoted; where promotion is unavailable or the user turned it off, it
/// stays a standard ongoing notification. On Xiaomi phones it also carries the HyperOS focus
/// format (see XiaomiFocus).
final class LiveUpdateNotificationAdapter {
    // The rest bar moves in steps this long; the countdown text itself is the system's, to the second.
    static final long PROGRESS_REFRESH_MS = 5000L;
    private static final long MINUTE_MS = 60_000L;
    private static final long SECOND_MS = 1000L;
    private static final int REQUEST_SHORTEN = RestAlerts.NOTIFICATION_ID_ONGOING + 10;
    private static final int REQUEST_EXTEND = RestAlerts.NOTIFICATION_ID_ONGOING + 11;
    private static final int REQUEST_SKIP = RestAlerts.NOTIFICATION_ID_ONGOING + 12;

    private LiveUpdateNotificationAdapter() {}

    static boolean supportsPromotion() {
        return Build.VERSION.SDK_INT >= 36;
    }

    static boolean canPromote(Context context) {
        if (!supportsPromotion()) return false;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        return manager != null && manager.canPostPromotedNotifications();
    }

    static Notification build(Context context, RestSnapshot snapshot) {
        long now = System.currentTimeMillis();
        NotificationCompat.Builder builder = create(context, snapshot, now, true);
        if (snapshot != null && snapshot.nextUp != null) {
            builder.setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                    .setPublicVersion(create(context, snapshot, now, false).build());
        }
        XiaomiFocus.apply(context, builder, snapshot, now);
        return builder.build();
    }

    /// Whether the notification changes over time in a way the system cannot draw by itself.
    static boolean needsProgressRefresh(RestSnapshot snapshot, long now) {
        return snapshot != null && snapshot.isRunning() && snapshot.deadlineMs > now && snapshot.totalMs > 0;
    }

    /// How long until the notification must be redrawn, or 0 when the system keeps it current: the
    /// rest bar every few seconds, and on HyperOS the island's rest countdown every second and its
    /// elapsed minutes at each new minute.
    static long refreshDelayMs(Context context, RestSnapshot snapshot, long now) {
        if (resting(snapshot, now) && compactIsland(context)) {
            // Redraw just after each whole second turns over, so the shown second is never stale.
            long untilNextSecond = (snapshot.deadlineMs - now) % SECOND_MS;
            return untilNextSecond == 0 ? SECOND_MS : untilNextSecond + 20;
        }
        if (needsProgressRefresh(snapshot, now)) return PROGRESS_REFRESH_MS;
        long start = trainingStart(snapshot, now);
        if (start <= 0 || !compactIsland(context)) return 0;
        return MINUTE_MS - (now - start) % MINUTE_MS;
    }

    /// HyperOS draws a promoted notification's title in the Super Island when it has no short
    /// text, and does not draw the chronometer there, so "Workout in progress" filled the island.
    /// Stock Android shows the ticking chronometer in its chip, which a short text would replace.
    static boolean compactIsland(Context context) {
        return XiaomiFocus.protocolVersion(context) >= 1;
    }

    /// When the workout's elapsed time started counting, less pauses; 0 outside plain training.
    private static long trainingStart(RestSnapshot snapshot, long now) {
        if (snapshot == null || snapshot.startedAtMs <= 0 || snapshot.pausedAtMs > 0 || snapshot.isPaused() ||
                snapshot.isRunning() && snapshot.deadlineMs > now) return 0;
        return snapshot.startedAtMs + snapshot.pausedSeconds * 1000L;
    }

    private static boolean resting(RestSnapshot snapshot, long now) {
        return snapshot != null && snapshot.isRunning() && snapshot.deadlineMs > now;
    }

    /// Rest left for the island, rounded up like the system countdown: "1:31", "0:05".
    static String remainingShort(long remainingMs) {
        long seconds = (Math.max(0, remainingMs) + SECOND_MS - 1) / SECOND_MS;
        return seconds / 60 + ":" + String.format(java.util.Locale.ROOT, "%02d", seconds % 60);
    }

    /// Elapsed workout time short enough for the island: "0m", "52m", "1h 05m".
    static String elapsedShort(long elapsedMs) {
        long minutes = Math.max(0, elapsedMs) / MINUTE_MS;
        return minutes < 60 ? minutes + "m" : minutes / 60 + "h " + String.format(java.util.Locale.ROOT, "%02dm", minutes % 60);
    }

    private static NotificationCompat.Builder create(Context context, RestSnapshot snapshot, long now, boolean detailed) {
        String sessionId = snapshot == null ? null : snapshot.sessionId;
        String nextUp = detailed && snapshot != null ? snapshot.nextUp : null;
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, RestAlerts.CHANNEL_ONGOING)
                .setSmallIcon(R.drawable.ic_stat_rest)
                .setColor(ContextCompat.getColor(context, R.color.brand_icon))
                .setContentIntent(RestAlerts.openWorkout(context, sessionId, RestAlerts.NOTIFICATION_ID_ONGOING))
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setShowWhen(true)
                // The watch shows its own timer; a mirrored copy would duplicate it.
                .setLocalOnly(true)
                .setCategory(NotificationCompat.CATEGORY_WORKOUT)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setRequestPromotedOngoing(true);

        if (snapshot != null && snapshot.isRunning() && snapshot.deadlineMs > now) {
            // Stock Android's chip draws the chronometer countdown when there is no short text.
            // HyperOS does not draw it in the island, so there the countdown is the short text,
            // redrawn every second by the service.
            if (compactIsland(context)) builder.setShortCriticalText(remainingShort(snapshot.deadlineMs - now));
            builder.setContentTitle("Resting")
                    .setContentText(nextUp != null ? "Next: " + nextUp : "Rest ends at the countdown.")
                    .setUsesChronometer(true)
                    .setChronometerCountDown(true)
                    .setWhen(snapshot.deadlineMs)
                    .addAction(0, "−30 s", RestActionReceiver.intent(context, RestAction.SHORTEN, snapshot, REQUEST_SHORTEN))
                    .addAction(0, "+30 s", RestActionReceiver.intent(context, RestAction.EXTEND, snapshot, REQUEST_EXTEND))
                    .addAction(0, "Skip", RestActionReceiver.intent(context, RestAction.SKIP, snapshot, REQUEST_SKIP));
            if (snapshot.totalMs > 0) builder.setStyle(restProgress(context, snapshot, now));
        } else if (snapshot != null && snapshot.isPaused()) {
            long seconds = (snapshot.pausedRemainingMs + 999) / 1000;
            builder.setContentTitle("Rest paused")
                    .setContentText(seconds + " s left")
                    .setUsesChronometer(false)
                    .setShowWhen(false)
                    .setShortCriticalText(seconds + "s");
        } else if (snapshot != null && snapshot.pausedAtMs > 0) {
            builder.setContentTitle("Workout paused")
                    .setContentText("Return to the app to resume.")
                    .setUsesChronometer(false)
                    .setShowWhen(false);
            if (compactIsland(context)) builder.setShortCriticalText("Paused");
        } else {
            builder.setContentTitle("Workout in progress")
                    .setContentText(nextUp != null ? "Next: " + nextUp : "Return to the app to log your next set.")
                    .addAction(0, "Return to workout", RestAlerts.openWorkout(context, sessionId, RestAlerts.NOTIFICATION_ID_ONGOING + 1));
            if (snapshot != null && snapshot.startedAtMs > 0) {
                // Counting up from the start, less the time spent paused, reads the workout's
                // elapsed time without any per-second update from the app.
                long start = snapshot.startedAtMs + snapshot.pausedSeconds * 1000L;
                builder.setUsesChronometer(true).setWhen(start);
                if (compactIsland(context)) builder.setShortCriticalText(elapsedShort(now - start));
            } else {
                builder.setShowWhen(false);
                if (compactIsland(context)) builder.setShortCriticalText("Workout");
            }
        }
        return builder;
    }

    /// The part of the rest already taken, as one accent-coloured track in whole seconds.
    private static NotificationCompat.ProgressStyle restProgress(Context context, RestSnapshot snapshot, long now) {
        int total = (int) Math.max(1, snapshot.totalMs / 1000);
        int left = (int) Math.max(0, (snapshot.deadlineMs - now + 999) / 1000);
        return new NotificationCompat.ProgressStyle()
                .setStyledByProgress(true)
                .addProgressSegment(new NotificationCompat.ProgressStyle.Segment(total)
                        .setColor(ContextCompat.getColor(context, R.color.brand_accent)))
                .setProgress(Math.max(0, Math.min(total, total - left)));
    }
}
