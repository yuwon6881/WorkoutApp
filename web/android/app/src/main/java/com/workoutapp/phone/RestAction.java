package com.workoutapp.phone;

import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/// A rest change made from the notification: −30 s, +30 s, or Skip. The service applies it at once
/// so the countdown and the deadline alarm move with the tap, even while the app is closed. The page
/// takes it later and makes the same change through its own rest flow, which is what reaches the
/// server and the watch. The arithmetic matches lib/restTimer.ts so both arrive at the same rest.
final class RestAction {
    static final String EXTEND = "extend";
    static final String SHORTEN = "shorten";
    static final String SKIP = "skip";
    static final long STEP_SECONDS = 30;

    final String sessionId;
    // The rest the tap was made on; an action never carries over to a different rest.
    final String generation;
    final String kind;
    final long seconds;
    final long atMs;

    RestAction(String sessionId, String generation, String kind, long seconds, long atMs) {
        this.sessionId = sessionId;
        this.generation = generation == null ? "" : generation;
        this.kind = EXTEND.equals(kind) || SHORTEN.equals(kind) ? kind : SKIP;
        this.seconds = SKIP.equals(this.kind) ? 0 : Math.max(0, seconds);
        this.atMs = atMs;
    }

    boolean belongsTo(RestSnapshot snapshot) {
        return snapshot != null && snapshot.isCurrent(sessionId, generation);
    }

    /// The rest after this action. An action for another rest, or for a rest already over, changes nothing.
    RestSnapshot applyTo(RestSnapshot snapshot) {
        if (!belongsTo(snapshot) || !(snapshot.isRunning() || snapshot.isPaused())) return snapshot;
        if (SKIP.equals(kind)) return idle(snapshot);
        long deltaMs = seconds * 1000L;
        if (snapshot.isPaused()) {
            long remaining = snapshot.pausedRemainingMs + (EXTEND.equals(kind) ? deltaMs : -deltaMs);
            if (remaining <= 0) return idle(snapshot);
            long total = EXTEND.equals(kind) && snapshot.totalMs > 0 ? snapshot.totalMs + deltaMs : snapshot.totalMs;
            return snapshot.withRest(RestSnapshot.PAUSED, 0, remaining, total);
        }
        if (EXTEND.equals(kind)) {
            long total = snapshot.totalMs > 0 ? snapshot.totalMs + deltaMs : 0;
            return snapshot.withRest(RestSnapshot.RUNNING, Math.max(atMs, snapshot.deadlineMs) + deltaMs, 0, total);
        }
        // Cutting past the end finishes the rest quietly: the lifter chose to go early.
        long deadline = snapshot.deadlineMs - deltaMs;
        return deadline > atMs ? snapshot.withRest(RestSnapshot.RUNNING, deadline, 0, snapshot.totalMs) : idle(snapshot);
    }

    /// Lays every action for this rest over the snapshot, in the order they were made.
    static RestSnapshot overlay(RestSnapshot snapshot, List<RestAction> actions) {
        RestSnapshot result = snapshot;
        for (RestAction action : actions) result = action.applyTo(result);
        return result;
    }

    private static RestSnapshot idle(RestSnapshot snapshot) {
        return snapshot.withRest(RestSnapshot.IDLE, 0, 0, 0);
    }

    JSONObject toJson() throws JSONException {
        return new JSONObject()
                .put("sessionId", sessionId)
                .put("generation", generation)
                .put("kind", kind)
                .put("seconds", seconds)
                .put("atMs", atMs);
    }

    static String listToJson(List<RestAction> actions) {
        JSONArray array = new JSONArray();
        try {
            for (RestAction action : actions) array.put(action.toJson());
        } catch (JSONException e) {
            return "[]";
        }
        return array.toString();
    }

    static List<RestAction> listFromJson(String json) {
        List<RestAction> actions = new ArrayList<>();
        if (json == null) return actions;
        try {
            JSONArray array = new JSONArray(json);
            for (int i = 0; i < array.length(); i++) {
                JSONObject o = array.getJSONObject(i);
                String sessionId = o.optString("sessionId", "");
                if (sessionId.isEmpty()) continue;
                actions.add(new RestAction(sessionId, o.optString("generation", ""), o.optString("kind", SKIP),
                        o.optLong("seconds", 0), o.optLong("atMs", 0)));
            }
        } catch (JSONException e) {
            actions.clear();
        }
        return actions;
    }
}
