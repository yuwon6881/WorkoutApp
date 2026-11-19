package com.workoutapp.phone;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import org.json.JSONObject;

/// An offer belongs to the live logger. Keep it in memory so a process restart cannot
/// advertise a button before a page is ready to handle its tap.
final class NotificationSetLogging {
    static final String ACTION = "com.workoutapp.phone.LOG_NOTIFICATION_SET";
    static final String LABEL = "Log set";
    static final String TOKEN = "set_card_token";
    private static final int REQUEST_CODE = 7240;
    private static Card current;
    private static boolean tapped;

    record Card(String sessionId, String token, String title, String values) {
        PendingIntent intent(Context context) {
            Intent intent = new Intent(context, RestActionReceiver.class).setAction(ACTION)
                    .setData(new Uri.Builder().scheme("workout-set").appendPath(sessionId).appendPath(token).build())
                    .addFlags(Intent.FLAG_RECEIVER_FOREGROUND)
                    .putExtra(TOKEN, token);
            return PendingIntent.getBroadcast(context, REQUEST_CODE, intent, PendingIntent.FLAG_IMMUTABLE);
        }
    }

    private NotificationSetLogging() {}

    static synchronized void publish(String sessionId, JSONObject payload) {
        Card next = parse(sessionId, payload);
        if (next != null && current != null && current.token.equals(next.token)) return;
        current = next;
        tapped = false;
    }

    private static Card parse(String sessionId, JSONObject payload) {
        if (payload == null) return null;
        String token = payload.optString("token", "");
        String title = payload.optString("title", "");
        String values = payload.optString("values", "");
        return token.isEmpty() || title.isEmpty() || values.isEmpty() ? null : new Card(sessionId, token, title, values);
    }

    static synchronized Card offer(RestSnapshot snapshot, long now) {
        if (tapped || current == null || snapshot == null || !current.sessionId.equals(snapshot.sessionId)
                || snapshot.pausedAtMs > 0 || snapshot.isPaused() || snapshot.deadlineMs > now) return null;
        return current;
    }

    static synchronized boolean claim(RestSnapshot snapshot, String token, long now) {
        Card offer = offer(snapshot, now);
        if (offer == null || !offer.token.equals(token)) return false;
        tapped = true;
        return true;
    }
}
