package com.workoutapp.phone;

import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

/// Keeps the active workout visible and its rest on time while the app is in the background. It
/// holds no state of its own: every start reads the stored snapshot, so a restart after process
/// loss shows the same workout, and a command that arrives late cannot restore an older rest.
public class WorkoutForegroundService extends Service {
    static final String ACTION_REFRESH = "com.workoutapp.phone.REFRESH";

    // A deadline this recent still alerts when the service sees it; anything older is a rest that
    // already ended while nothing was running, and is shown as finished instead of replayed.
    static final long ALERT_GRACE_MS = 10_000L;
    private static final long MAX_WAKE_LOCK_MS = 15 * 60 * 1000L;
    private static final long WAKE_LOCK_GRACE_MS = 5000L;

    private static volatile boolean running;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable deadline = this::onDeadline;
    private PowerManager.WakeLock wakeLock;

    static boolean isRunning() {
        return running;
    }

    /// Starts or refreshes the service. Android refuses a foreground start from the background;
    /// the caller reports that instead of pretending the workout is shown.
    static void start(Context context) {
        Intent intent = new Intent(context, WorkoutForegroundService.class).setAction(ACTION_REFRESH);
        if (running) context.startService(intent);
        else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent);
        else context.startService(intent);
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, WorkoutForegroundService.class));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        RestAlerts.createChannels(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        RestSnapshot snapshot = WorkoutRecoveryStore.get(this).getRestSnapshot();
        // Being started as a foreground service obliges a notification even when there is no
        // longer a workout to show, so promote first and stop afterwards.
        promote(snapshot);
        if (snapshot == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        apply(snapshot);
        return START_STICKY;
    }

    private void promote(RestSnapshot snapshot) {
        Notification notification = LiveUpdateNotificationAdapter.build(this, snapshot);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(RestAlerts.NOTIFICATION_ID_ONGOING, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(RestAlerts.NOTIFICATION_ID_ONGOING, notification);
        }
    }

    private void apply(RestSnapshot snapshot) {
        handler.removeCallbacks(deadline);
        releaseWakeLock();
        RestSchedule.apply(this, snapshot);
        long remaining = snapshot.deadlineMs - System.currentTimeMillis();
        if (snapshot.isRunning() && remaining > 0) {
            // The alarm is the fallback for process loss; while this process lives, a bounded
            // wake lock keeps the callback on time through the rest and releases itself after.
            acquireWakeLock(Math.min(MAX_WAKE_LOCK_MS, remaining + WAKE_LOCK_GRACE_MS));
            handler.postDelayed(deadline, remaining);
        } else if (snapshot.isRunning() && -remaining <= ALERT_GRACE_MS) {
            alertOnce(this, snapshot);
        }
    }

    private void onDeadline() {
        RestSnapshot snapshot = WorkoutRecoveryStore.get(this).getRestSnapshot();
        if (snapshot != null && snapshot.isRunning() && snapshot.deadlineMs <= System.currentTimeMillis() + 500) {
            alertOnce(this, snapshot);
        }
        releaseWakeLock();
        if (snapshot != null) promote(snapshot);
    }

    /// Alerts for the stored rest at most once on this device, whichever of the page, this
    /// callback, and the alarm gets there first.
    static void alertOnce(Context context, RestSnapshot snapshot) {
        if (!snapshot.alert) return;
        if (WorkoutRecoveryStore.get(context).claimRestAlert(snapshot.sessionId, snapshot.generation)) {
            RestAlerts.post(context, snapshot.sessionId, snapshot.sound, snapshot.vibrate);
        }
    }

    private void acquireWakeLock(long timeoutMs) {
        PowerManager power = getSystemService(PowerManager.class);
        if (power == null) return;
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "WorkoutApp:Rest");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire(timeoutMs);
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(deadline);
        releaseWakeLock();
        // An ended workout takes its alarm with it; a service the system reclaimed mid-rest leaves
        // the alarm armed so the rest still alerts.
        if (WorkoutRecoveryStore.get(this).getRestSnapshot() == null) RestSchedule.cancel(this);
        running = false;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
