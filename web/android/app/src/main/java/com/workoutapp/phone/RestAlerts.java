package com.workoutapp.phone;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.os.Build;
import android.os.VibrationAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

/// The rest-complete alert: a silent heads-up notification plus the chime (see RestChime) and an
/// optional vibration. The chime is played by the app rather than as the channel's sound, so it
/// is heard over music and on a phone set to vibrate; the app's Sound switch and Do Not Disturb
/// still silence it, and it never forces the volume.
final class RestAlerts {
    static final String CHANNEL_ONGOING = "workout_ongoing";
    // A channel's sound cannot change after creation, so the silent channel has a new id; the
    // older ones played the chime as the notification sound.
    static final String CHANNEL_ALERT = "workout_rest_done";
    private static final String[] LEGACY_ALERT_CHANNELS = {"workout_alerts", "workout_rest_complete"};
    static final int NOTIFICATION_ID_ONGOING = 7101;
    static final int NOTIFICATION_ID_ALERT = 7102;
    private static final long[] VIBRATION = {0, 250, 150, 250};
    private static final long FINISHED_TIMEOUT_MS = 5 * 60 * 1000L;

    private RestAlerts() {}

    static void createChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        for (String legacy : LEGACY_ALERT_CHANNELS) manager.deleteNotificationChannel(legacy);

        NotificationChannel ongoing = new NotificationChannel(CHANNEL_ONGOING, "Workout in progress", NotificationManager.IMPORTANCE_LOW);
        ongoing.setDescription("The workout's elapsed time and the rest countdown.");
        ongoing.setShowBadge(false);
        ongoing.setSound(null, null);
        ongoing.enableVibration(false);
        manager.createNotificationChannel(ongoing);

        NotificationChannel alert = new NotificationChannel(CHANNEL_ALERT, "Rest finished", NotificationManager.IMPORTANCE_HIGH);
        alert.setDescription("Shows when a rest ends. The chime is set by the app's Sound switch.");
        // The app plays the chime itself; a channel sound would be a second one.
        alert.setSound(null, null);
        // Vibration follows the app's own preference, so the channel adds none of its own.
        alert.enableVibration(false);
        manager.createNotificationChannel(alert);
    }

    static boolean notificationsEnabled(Context context) {
        return androidx.core.app.NotificationManagerCompat.from(context).areNotificationsEnabled();
    }

    static boolean restChannelEnabled(Context context) {
        if (!notificationsEnabled(context)) return false;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        NotificationChannel channel = manager == null ? null : manager.getNotificationChannel(CHANNEL_ALERT);
        return channel != null && channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }

    /// The chime does not depend on the channel; only Do Not Disturb can hold it back.
    static boolean restSoundEnabled(Context context) {
        return chimeAllowed(context);
    }

    static void post(Context context, String sessionId, boolean sound, boolean vibrate) {
        post(context, sessionId, true, sound, vibrate, () -> { });
    }

    /// Alerts for a finished rest: the notification when `notify` is set and the channel can post,
    /// then the chime and vibration, each by its own switch. `done` runs once the chime has played.
    static void post(Context context, String sessionId, boolean notify, boolean sound, boolean vibrate, Runnable done) {
        createChannels(context);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ALERT)
                .setSmallIcon(R.drawable.ic_stat_rest)
                .setContentTitle("Rest finished")
                .setContentText("Time for your next set.")
                .setContentIntent(openWorkout(context, sessionId, NOTIFICATION_ID_ALERT))
                .setAutoCancel(true)
                // The watch alerts on its own; a mirrored copy would be a second alert on the wrist.
                .setLocalOnly(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setColor(ContextCompat.getColor(context, R.color.brand_accent))
                // Once the next set is under way the alert is old news; the next rest clears it sooner.
                .setTimeoutAfter(FINISHED_TIMEOUT_MS)
                .setSilent(true);
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (notify && manager != null && restChannelEnabled(context)) manager.notify(NOTIFICATION_ID_ALERT, builder.build());
        if (vibrate && vibrationAllowed(context)) vibrate(context);
        if (sound && chimeAllowed(context)) RestChime.play(context, done);
        else done.run();
    }

    /// The chime plays in silent and vibrate mode, like a navigation prompt, but not under Do Not
    /// Disturb unless the user let the rest channel through.
    static boolean chimeAllowed(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return true;
        int filter = manager.getCurrentInterruptionFilter();
        if (filter == NotificationManager.INTERRUPTION_FILTER_ALL || filter == NotificationManager.INTERRUPTION_FILTER_UNKNOWN) return true;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false;
        NotificationChannel channel = manager.getNotificationChannel(CHANNEL_ALERT);
        return channel != null && channel.canBypassDnd();
    }

    static void clearFinished(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) manager.cancel(NOTIFICATION_ID_ALERT);
    }

    /// The app vibrates by itself, so it applies the phone's own quiet settings: nothing in silent
    /// mode, and nothing under Do Not Disturb unless the user let this channel through.
    static boolean vibrationAllowed(Context context) {
        AudioManager audio = context.getSystemService(AudioManager.class);
        if (audio != null && audio.getRingerMode() == AudioManager.RINGER_MODE_SILENT) return false;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return true;
        int filter = manager.getCurrentInterruptionFilter();
        if (filter == NotificationManager.INTERRUPTION_FILTER_ALL || filter == NotificationManager.INTERRUPTION_FILTER_UNKNOWN) return true;
        NotificationChannel channel = manager.getNotificationChannel(CHANNEL_ALERT);
        return channel != null && channel.canBypassDnd();
    }

    static PendingIntent openWorkout(Context context, String sessionId, int requestCode) {
        Intent open = new Intent(context, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (sessionId != null) open.putExtra(MainActivity.EXTRA_WORKOUT_ID, sessionId);
        return PendingIntent.getActivity(context, requestCode, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void vibrate(Context context) {
        Vibrator vibrator;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager manager = context.getSystemService(VibratorManager.class);
            vibrator = manager == null ? null : manager.getDefaultVibrator();
        } else {
            vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
        }
        if (vibrator == null || !vibrator.hasVibrator()) return;
        // Marked as a notification vibration: Android drops unmarked vibrations from an app in the
        // background, which is exactly when a rest usually ends, and applies the user's
        // notification vibration settings to marked ones.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            vibrator.vibrate(VibrationEffect.createWaveform(VIBRATION, -1),
                    VibrationAttributes.createForUsage(VibrationAttributes.USAGE_NOTIFICATION));
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createWaveform(VIBRATION, -1), new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
        } else {
            vibrator.vibrate(VIBRATION, -1);
        }
    }

}
