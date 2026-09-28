package com.workoutapp.phone;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/// Alarms do not survive a reboot or an app update. Only a rest whose deadline is still ahead is
/// armed again; one that ended while the phone was off is never replayed. The workout
/// notification returns when the app is next opened, since a background start is not allowed.
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) return;
        RestSnapshot snapshot = WorkoutRecoveryStore.get(context).getRestSnapshot();
        if (snapshot != null && snapshot.isRunning() && snapshot.deadlineMs > System.currentTimeMillis()) {
            RestSchedule.apply(context, snapshot);
        }
    }
}
