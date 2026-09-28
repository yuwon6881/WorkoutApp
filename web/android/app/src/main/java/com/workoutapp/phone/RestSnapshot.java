package com.workoutapp.phone;

import org.json.JSONException;
import org.json.JSONObject;

/// The one workout and rest state every native part reads: the service, the deadline alarm, the
/// boot receiver, and the notification. The web app writes it whole, so a late or repeated write
/// can only restate an intent, and `epoch`/`sequence` let the store refuse one that is older.
final class RestSnapshot {
    static final String RUNNING = "running";
    static final String PAUSED = "paused";
    static final String IDLE = "idle";

    final String sessionId;
    final String generation;
    final String status;
    final long deadlineMs;
    final long pausedRemainingMs;
    final long startedAtMs;
    final long pausedAtMs;
    final long pausedSeconds;
    final boolean alert;
    final boolean sound;
    final boolean vibrate;
    final String epoch;
    final long sequence;

    RestSnapshot(String sessionId, String generation, String status, long deadlineMs, long pausedRemainingMs,
                 long startedAtMs, long pausedAtMs, long pausedSeconds, boolean alert, boolean sound,
                 boolean vibrate, String epoch, long sequence) {
        this.sessionId = sessionId;
        this.generation = generation == null ? "" : generation;
        this.status = RUNNING.equals(status) || PAUSED.equals(status) ? status : IDLE;
        this.deadlineMs = deadlineMs;
        this.pausedRemainingMs = pausedRemainingMs;
        this.startedAtMs = startedAtMs;
        this.pausedAtMs = pausedAtMs;
        this.pausedSeconds = pausedSeconds;
        this.alert = alert;
        this.sound = sound;
        this.vibrate = vibrate;
        this.epoch = epoch == null ? "" : epoch;
        this.sequence = sequence;
    }

    boolean isRunning() {
        return RUNNING.equals(status) && deadlineMs > 0;
    }

    boolean isPaused() {
        return PAUSED.equals(status) && pausedRemainingMs > 0;
    }

    boolean isCurrent(String session, String restGeneration) {
        return sessionId != null && sessionId.equals(session) && !generation.isEmpty() && generation.equals(restGeneration);
    }

    /// A write from the same page must be newer than the last one; a new page (a reload or a new
    /// launch) starts a new epoch and always restates the workout.
    boolean supersedes(RestSnapshot previous) {
        return previous == null || !epoch.equals(previous.epoch) || sequence > previous.sequence;
    }

    String toJson() {
        try {
            return new JSONObject()
                    .put("sessionId", sessionId)
                    .put("generation", generation)
                    .put("status", status)
                    .put("deadlineMs", deadlineMs)
                    .put("pausedRemainingMs", pausedRemainingMs)
                    .put("startedAtMs", startedAtMs)
                    .put("pausedAtMs", pausedAtMs)
                    .put("pausedSeconds", pausedSeconds)
                    .put("alert", alert)
                    .put("sound", sound)
                    .put("vibrate", vibrate)
                    .put("epoch", epoch)
                    .put("sequence", sequence)
                    .toString();
        } catch (JSONException e) {
            return null;
        }
    }

    static RestSnapshot fromJson(String json) {
        if (json == null) return null;
        try {
            JSONObject o = new JSONObject(json);
            String sessionId = o.optString("sessionId", "");
            if (sessionId.isEmpty()) return null;
            return new RestSnapshot(sessionId, o.optString("generation", ""), o.optString("status", IDLE),
                    o.optLong("deadlineMs", 0), o.optLong("pausedRemainingMs", 0), o.optLong("startedAtMs", 0),
                    o.optLong("pausedAtMs", 0), o.optLong("pausedSeconds", 0), o.optBoolean("alert", false),
                    o.optBoolean("sound", true), o.optBoolean("vibrate", false), o.optString("epoch", ""),
                    o.optLong("sequence", 0));
        } catch (JSONException e) {
            return null;
        }
    }
}
