package com.workoutapp.phone;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/// The deadline alarm's receiver. It alerts only for the rest that is still stored as current, so
/// an alarm left over from a replaced, skipped, or finished rest does nothing.
public class RestAlarmReceiver extends BroadcastReceiver {
    static final String EXTRA_SESSION_ID = "session_id";
    static final String EXTRA_GENERATION = "generation";
    static final String EXTRA_TEST = "test";
    static final String EXTRA_SOUND = "sound";
    static final String EXTRA_VIBRATE = "vibrate";

    // An idle phone may hold an inexact alarm back; a rest that ended long ago is not announced.
    private static final long LATE_LIMIT_MS = 10 * 60 * 1000L;

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent.getBooleanExtra(EXTRA_TEST, false)) {
            RestAlerts.post(context, null, intent.getBooleanExtra(EXTRA_SOUND, true), intent.getBooleanExtra(EXTRA_VIBRATE, false));
            return;
        }
        RestSnapshot snapshot = WorkoutRecoveryStore.get(context).getRestSnapshot();
        if (snapshot == null || !snapshot.isRunning()
                || !snapshot.isCurrent(intent.getStringExtra(EXTRA_SESSION_ID), intent.getStringExtra(EXTRA_GENERATION))) return;
        long late = System.currentTimeMillis() - snapshot.deadlineMs;
        if (late < -1000 || late > LATE_LIMIT_MS) return;
        WorkoutForegroundService.alertOnce(context, snapshot);
        // A running service redraws the notification from the countdown to the workout's time.
        if (WorkoutForegroundService.isRunning()) {
            try { WorkoutForegroundService.start(context); } catch (RuntimeException ignored) { /* the next app visit redraws it */ }
        }
    }
}
