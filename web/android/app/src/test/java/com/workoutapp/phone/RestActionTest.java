package com.workoutapp.phone;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.List;
import org.junit.Test;

public class RestActionTest {
    private static final long NOW = 1_000_000L;

    private static RestSnapshot running(long deadlineMs, long totalMs) {
        return new RestSnapshot("workout-1", "gen-1", RestSnapshot.RUNNING, deadlineMs, 0, 500_000L, 0, 0,
                true, true, false, "page-a", 4, totalMs, "Bench press · set 2");
    }

    private static RestAction action(String kind) {
        return new RestAction("workout-1", "gen-1", kind, RestAction.STEP_SECONDS, NOW);
    }

    @Test
    public void adding_time_extends_the_deadline_and_the_length_like_the_page_does() {
        RestSnapshot after = action(RestAction.EXTEND).applyTo(running(NOW + 40_000, 90_000));
        assertEquals(NOW + 70_000, after.deadlineMs);
        assertEquals(120_000, after.totalMs);
        assertEquals("gen-1", after.generation);
        assertEquals("page-a", after.epoch);
        assertEquals(4, after.sequence);
        assertEquals("Bench press · set 2", after.nextUp);
    }

    @Test
    public void taking_time_off_keeps_the_length_and_past_the_end_finishes_the_rest() {
        RestSnapshot shortened = action(RestAction.SHORTEN).applyTo(running(NOW + 40_000, 90_000));
        assertEquals(NOW + 10_000, shortened.deadlineMs);
        assertEquals(90_000, shortened.totalMs);
        RestSnapshot finished = action(RestAction.SHORTEN).applyTo(running(NOW + 20_000, 90_000));
        assertEquals(RestSnapshot.IDLE, finished.status);
    }

    @Test
    public void skip_ends_the_rest_but_keeps_the_workout() {
        RestSnapshot skipped = action(RestAction.SKIP).applyTo(running(NOW + 40_000, 90_000));
        assertEquals(RestSnapshot.IDLE, skipped.status);
        assertEquals("workout-1", skipped.sessionId);
        assertEquals(500_000L, skipped.startedAtMs);
    }

    @Test
    public void a_paused_rest_changes_its_remaining_time() {
        RestSnapshot paused = new RestSnapshot("workout-1", "gen-1", RestSnapshot.PAUSED, 0, 40_000, 500_000L, 0, 0,
                true, true, false, "page-a", 4, 90_000, null);
        assertEquals(70_000, action(RestAction.EXTEND).applyTo(paused).pausedRemainingMs);
        assertEquals(10_000, action(RestAction.SHORTEN).applyTo(paused).pausedRemainingMs);
    }

    @Test
    public void an_action_for_another_rest_changes_nothing() {
        RestSnapshot current = running(NOW + 40_000, 90_000);
        RestAction stale = new RestAction("workout-1", "gen-0", RestAction.SKIP, 0, NOW);
        assertSame(current, stale.applyTo(current));
    }

    @Test
    public void actions_apply_in_the_order_they_were_made() {
        List<RestAction> taps = Arrays.asList(action(RestAction.EXTEND), action(RestAction.EXTEND), action(RestAction.SHORTEN));
        assertEquals(NOW + 70_000, RestAction.overlay(running(NOW + 40_000, 90_000), taps).deadlineMs);
    }

    @Test
    public void the_stored_list_round_trips_and_ignores_garbage() {
        List<RestAction> read = RestAction.listFromJson(RestAction.listToJson(Arrays.asList(action(RestAction.EXTEND), action(RestAction.SKIP))));
        assertEquals(2, read.size());
        assertEquals(RestAction.EXTEND, read.get(0).kind);
        assertEquals(30, read.get(0).seconds);
        assertEquals(RestAction.SKIP, read.get(1).kind);
        assertEquals(0, read.get(1).seconds);
        assertTrue(RestAction.listFromJson("not json").isEmpty());
        assertTrue(RestAction.listFromJson(null).isEmpty());
    }

    @Test
    public void the_snapshot_keeps_its_length_and_next_set_through_storage() {
        RestSnapshot read = RestSnapshot.fromJson(running(NOW, 90_000).toJson());
        assertEquals(90_000, read.totalMs);
        assertEquals("Bench press · set 2", read.nextUp);
        RestSnapshot without = RestSnapshot.fromJson(new RestSnapshot("w", "g", RestSnapshot.IDLE, 0, 0, 0, 0, 0,
                false, true, false, "e", 1).toJson());
        assertNull(without.nextUp);
    }
}
