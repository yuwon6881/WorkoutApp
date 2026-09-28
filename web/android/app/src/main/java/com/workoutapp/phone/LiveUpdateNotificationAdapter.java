package com.workoutapp.phone;

import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;
import androidx.core.app.NotificationCompat;

/// The ongoing workout notification: elapsed time while training, the rest countdown while
/// resting, and a paused state, all counted by the system chronometer rather than by the page.
/// Content is generic so the lock screen never shows exercise names or logged values. On Android
/// versions with Live Updates it asks to be promoted; where promotion is unavailable or the user
/// turned it off, it stays a standard ongoing notification.
final class LiveUpdateNotificationAdapter {
    private LiveUpdateNotificationAdapter() {}

    static boolean canPromote(Context context) {
        if (Build.VERSION.SDK_INT < 36) return false;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        return manager != null && manager.canPostPromotedNotifications();
    }

    static Notification build(Context context, RestSnapshot snapshot) {
        long now = System.currentTimeMillis();
        String sessionId = snapshot == null ? null : snapshot.sessionId;
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, RestAlerts.CHANNEL_ONGOING)
                .setSmallIcon(R.drawable.ic_stat_rest)
                .setContentIntent(RestAlerts.openWorkout(context, sessionId, RestAlerts.NOTIFICATION_ID_ONGOING))
                .addAction(0, "Return to workout", RestAlerts.openWorkout(context, sessionId, RestAlerts.NOTIFICATION_ID_ONGOING + 1))
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
            builder.setContentTitle("Resting")
                    .setContentText("Rest ends at the countdown.")
                    .setUsesChronometer(true)
                    .setChronometerCountDown(true)
                    .setWhen(snapshot.deadlineMs)
                    .setShortCriticalText("Rest");
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
        } else {
            builder.setContentTitle("Workout in progress")
                    .setContentText("Return to the app to log your next set.");
            if (snapshot != null && snapshot.startedAtMs > 0) {
                // Counting up from the start, less the time spent paused, reads the workout's
                // elapsed time without any per-second update from the app.
                builder.setUsesChronometer(true).setWhen(snapshot.startedAtMs + snapshot.pausedSeconds * 1000L);
            } else {
                builder.setShowWhen(false);
            }
        }
        return builder.build();
    }
}
