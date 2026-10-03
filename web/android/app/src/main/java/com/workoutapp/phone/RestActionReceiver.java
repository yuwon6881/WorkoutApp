package com.workoutapp.phone;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/// The −30 s, +30 s, and Skip buttons on the workout notification. A broadcast rather than an
/// activity, so they work from the lock screen without unlocking. The change shows at once; the
/// page sends it on to the server the next time it runs (see RestAction).
public class RestActionReceiver extends BroadcastReceiver {
    static final String ACTION_REST = "com.workoutapp.phone.REST_ACTION";
    static final String EXTRA_KIND = "kind";
    static final String EXTRA_SESSION_ID = "session_id";
    static final String EXTRA_GENERATION = "generation";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!ACTION_REST.equals(intent.getAction())) return;
        String kind = intent.getStringExtra(EXTRA_KIND);
        RestAction action = new RestAction(intent.getStringExtra(EXTRA_SESSION_ID), intent.getStringExtra(EXTRA_GENERATION),
                kind, RestAction.SKIP.equals(kind) ? 0 : RestAction.STEP_SECONDS, System.currentTimeMillis());
        RestSnapshot updated = WorkoutRecoveryStore.get(context).applyRestAction(action);
        // A button left on an older notification after its rest changed does nothing.
        if (updated == null) return;
        RestSchedule.apply(context, updated);
        try {
            WorkoutForegroundService.start(context);
        } catch (RuntimeException ignored) {
            // The stored rest and its alarm are already right; the notification catches up when the app opens.
        }
        WorkoutPlugin.notifyRestAction();
    }

    static PendingIntent intent(Context context, String kind, RestSnapshot snapshot, int requestCode) {
        Intent intent = new Intent(context, RestActionReceiver.class)
                .setAction(ACTION_REST)
                .putExtra(EXTRA_KIND, kind)
                .putExtra(EXTRA_SESSION_ID, snapshot.sessionId)
                .putExtra(EXTRA_GENERATION, snapshot.generation);
        return PendingIntent.getBroadcast(context, requestCode, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
