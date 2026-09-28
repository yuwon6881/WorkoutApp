package com.workoutapp.phone;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/// The deadline alarm. It belongs to the stored rest, not to the service, so a rest still alerts
/// when the service cannot start or its process is lost. Exact timing is used only when the user
/// allowed it; otherwise the alarm is inexact and the settings panel says so.
final class RestSchedule {
    private static final int REQUEST_REST = 201;
    private static final int REQUEST_TEST = 202;
    static final long TEST_DELAY_MS = 5000L;

    private RestSchedule() {}

    static boolean canScheduleExact(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        return alarms != null && alarms.canScheduleExactAlarms();
    }

    /// Arms the alarm for a running rest whose deadline is still ahead; anything else cancels it.
    static void apply(Context context, RestSnapshot snapshot) {
        if (snapshot == null || !snapshot.alert || !snapshot.isRunning() || snapshot.deadlineMs <= System.currentTimeMillis()) {
            cancel(context);
            return;
        }
        Intent intent = new Intent(context, RestAlarmReceiver.class)
                .putExtra(RestAlarmReceiver.EXTRA_SESSION_ID, snapshot.sessionId)
                .putExtra(RestAlarmReceiver.EXTRA_GENERATION, snapshot.generation);
        set(context, snapshot.deadlineMs, PendingIntent.getBroadcast(context, REQUEST_REST, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
    }

    static void cancel(Context context) {
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        PendingIntent pending = PendingIntent.getBroadcast(context, REQUEST_REST, new Intent(context, RestAlarmReceiver.class),
                PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
        if (alarms != null && pending != null) {
            alarms.cancel(pending);
            pending.cancel();
        }
    }

    /// A test alert travels the same path as a real one, a few seconds from now, so it can be
    /// checked with the screen locked; it never touches the workout's own rest.
    static void scheduleTest(Context context, boolean sound, boolean vibrate) {
        Intent intent = new Intent(context, RestAlarmReceiver.class)
                .putExtra(RestAlarmReceiver.EXTRA_TEST, true)
                .putExtra(RestAlarmReceiver.EXTRA_SOUND, sound)
                .putExtra(RestAlarmReceiver.EXTRA_VIBRATE, vibrate);
        set(context, System.currentTimeMillis() + TEST_DELAY_MS, PendingIntent.getBroadcast(context, REQUEST_TEST, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
    }

    private static void set(Context context, long atMs, PendingIntent pending) {
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        if (alarms == null) return;
        if (canScheduleExact(context)) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, pending);
        else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, pending);
    }
}
