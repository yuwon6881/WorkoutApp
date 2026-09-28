package com.workoutapp.phone;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class RestSnapshotTest {
    private static RestSnapshot snapshot(String generation, String status, String epoch, long sequence) {
        return new RestSnapshot("workout-1", generation, status, 1_000_000L, 0, 500_000L, 0, 12, true, true, false, epoch, sequence);
    }

    @Test
    public void an_older_write_from_the_same_page_never_replaces_a_newer_one() {
        RestSnapshot newer = snapshot("gen-2", RestSnapshot.RUNNING, "page-a", 7);
        assertFalse(snapshot("gen-1", RestSnapshot.RUNNING, "page-a", 6).supersedes(newer));
        assertFalse(snapshot("gen-2", RestSnapshot.RUNNING, "page-a", 7).supersedes(newer));
        assertTrue(snapshot("gen-3", RestSnapshot.IDLE, "page-a", 8).supersedes(newer));
    }

    @Test
    public void a_new_page_always_restates_the_workout() {
        RestSnapshot previous = snapshot("gen-2", RestSnapshot.RUNNING, "page-a", 40);
        assertTrue(snapshot("gen-2", RestSnapshot.RUNNING, "page-b", 1).supersedes(previous));
        assertTrue(snapshot("gen-2", RestSnapshot.RUNNING, "page-b", 1).supersedes(null));
    }

    @Test
    public void only_the_stored_rest_counts_as_current() {
        RestSnapshot stored = snapshot("gen-2", RestSnapshot.RUNNING, "page-a", 1);
        assertTrue(stored.isCurrent("workout-1", "gen-2"));
        assertFalse(stored.isCurrent("workout-1", "gen-1"));
        assertFalse(stored.isCurrent("workout-2", "gen-2"));
        assertFalse(snapshot("", RestSnapshot.RUNNING, "page-a", 1).isCurrent("workout-1", ""));
    }

    @Test
    public void unknown_statuses_read_as_idle_and_idle_is_neither_running_nor_paused() {
        RestSnapshot unknown = snapshot("gen-1", "elapsed", "page-a", 1);
        assertEquals(RestSnapshot.IDLE, unknown.status);
        assertFalse(unknown.isRunning());
        assertFalse(unknown.isPaused());
    }

    @Test
    public void the_stored_form_round_trips() {
        RestSnapshot original = snapshot("gen-9", RestSnapshot.PAUSED, "page-z", 3);
        RestSnapshot read = RestSnapshot.fromJson(original.toJson());
        assertEquals(original.sessionId, read.sessionId);
        assertEquals(original.generation, read.generation);
        assertEquals(original.status, read.status);
        assertEquals(original.deadlineMs, read.deadlineMs);
        assertEquals(original.startedAtMs, read.startedAtMs);
        assertEquals(original.pausedSeconds, read.pausedSeconds);
        assertEquals(original.epoch, read.epoch);
        assertEquals(original.sequence, read.sequence);
        assertEquals(original.alert, read.alert);
        assertNull(RestSnapshot.fromJson("{}"));
        assertNull(RestSnapshot.fromJson("not json"));
    }
}
