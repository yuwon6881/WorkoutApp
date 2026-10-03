package com.workoutapp.phone;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

/// The rest-complete alert: the one native place that sounds. The chime is the channel's own
/// sound, so the system applies Do Not Disturb, silent mode, the channel's user settings, and
/// audio routing; this code never forces volume or bypasses any of them.
final class RestAlerts {
    static final String CHANNEL_ONGOING = "workout_ongoing";
    // Renamed from the first build's alert channel, whose sound could not be changed after creation.
    static final String CHANNEL_ALERT = "workout_rest_complete";
    private static final String LEGACY_ALERT_CHANNEL = "workout_alerts";
    static final int NOTIFICATION_ID_ONGOING = 7101;
    static final int NOTIFICATION_ID_ALERT = 7102;
    private static final long[] VIBRATION = {0, 250, 150, 250};
    private static final long FINISHED_TIMEOUT_MS = 5 * 60 * 1000L;

    private RestAlerts() {}

    static void createChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        manager.deleteNotificationChannel(LEGACY_ALERT_CHANNEL);

        NotificationChannel ongoing = new NotificationChannel(CHANNEL_ONGOING, "Workout in progress", NotificationManager.IMPORTANCE_LOW);
        ongoing.setDescription("The workout's elapsed time and the rest countdown.");
        ongoing.setShowBadge(false);
        ongoing.setSound(null, null);
        ongoing.enableVibration(false);
        manager.createNotificationChannel(ongoing);

        NotificationChannel alert = new NotificationChannel(CHANNEL_ALERT, "Rest finished", NotificationManager.IMPORTANCE_HIGH);
        alert.setDescription("Plays the rest chime when a rest ends.");
        alert.setSound(chime(context), new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build());
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

    static boolean restSoundEnabled(Context context) {
        if (!restChannelEnabled(context)) return false;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        NotificationChannel channel = manager == null ? null : manager.getNotificationChannel(CHANNEL_ALERT);
        return channel != null && channel.getImportance() >= NotificationManager.IMPORTANCE_DEFAULT
                && channel.getSound() != null;
    }

    /// Posts the alert. With sound turned off in the app it is silent; vibration is separate.
    static void post(Context context, String sessionId, boolean sound, boolean vibrate) {
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
                .setColor(ContextCompat.getColor(context, R.color.ayu_accent))
                // Once the next set is under way the alert is old news; the next rest clears it sooner.
                .setTimeoutAfter(FINISHED_TIMEOUT_MS)
                .setSilent(!sound);
        if (sound && Build.VERSION.SDK_INT < Build.VERSION_CODES.O) builder.setSound(chime(context));
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null && restChannelEnabled(context)) manager.notify(NOTIFICATION_ID_ALERT, builder.build());
        if (vibrate && restChannelEnabled(context) && vibrationAllowed(context)) vibrate(context);
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

    private static Uri chime(Context context) {
        return Uri.parse("android.resource://" + context.getPackageName() + "/" + R.raw.rest_chime);
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
