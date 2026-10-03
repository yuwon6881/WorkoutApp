package com.workoutapp.phone;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.Intent;
import android.app.AlarmManager;
import org.robolectric.Shadows;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import java.io.File;
import java.lang.reflect.Field;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class WorkoutRecoveryStoreTest {
    private WorkoutRecoveryStore store;
    private SQLiteOpenHelper helper;
    private SQLiteDatabase db;

    @Before public void openStore() throws Exception {
        Field instance = WorkoutRecoveryStore.class.getDeclaredField("instance");
        instance.setAccessible(true);
        instance.set(null, null);
        Context context = RuntimeEnvironment.getApplication();
        new File(context.getNoBackupFilesDir(), "workout_recovery.db").delete();
        store = WorkoutRecoveryStore.get(context);
        Field field = WorkoutRecoveryStore.class.getDeclaredField("helper");
        field.setAccessible(true);
        helper = (SQLiteOpenHelper) field.get(store);
        db = helper.getWritableDatabase();
    }

    @After public void closeStore() { helper.close(); }

    private void rejectInserts(String table) {
        // RAISE(IGNORE) exercises SQLite's negative insert result without manufacturing disk faults.
        db.execSQL("CREATE TRIGGER reject_write BEFORE INSERT ON " + table +
                " BEGIN SELECT RAISE(IGNORE); END");
    }

    @Test public void failedRecoveryWriteIsNotAcknowledged() {
        rejectInserts("workout_recovery");
        assertThrows(RuntimeException.class, () -> store.saveRecovery("account", "session", "{}"));
        assertNull(store.getRecovery("account"));
    }

    @Test public void failedLastAccountWriteIsNotAcknowledged() {
        rejectInserts("recovery_meta");
        assertThrows(RuntimeException.class, () -> store.setLastAccountId("account"));
        assertNull(store.getLastAccountId());
    }

    @Test public void failedRestWriteDoesNotReportStored() {
        rejectInserts("recovery_meta");
        RestSnapshot snapshot = new RestSnapshot("session", "generation", RestSnapshot.RUNNING,
                2000, 0, 1000, 0, 0, true, true, false, "epoch", 1);
        assertThrows(RuntimeException.class, () -> store.saveRestSnapshotIfNewer(snapshot));
        assertNull(store.getRestSnapshot());
    }

    @Test public void recoveryReplacementStaysAccountScoped() {
        store.saveRecovery("one", "session", "first");
        store.saveRecovery("two", "other", "other-account");
        store.saveRecovery("one", "session", "updated");
        assertEquals("updated", store.getRecovery("one"));
        assertEquals("other-account", store.getRecovery("two"));
    }

    private static RestSnapshot page(String generation, long deadlineMs, String epoch, long sequence) {
        return new RestSnapshot("session", generation, RestSnapshot.RUNNING, deadlineMs, 0, 1000, 0, 0,
                true, true, false, epoch, sequence, 90_000, null);
    }

    @Test public void aNotificationTapSurvivesThePageRestatingTheSameRest() {
        long now = System.currentTimeMillis();
        store.saveRestSnapshotIfNewer(page("gen-1", now + 40_000, "page-a", 1));
        RestSnapshot tapped = store.applyRestAction(new RestAction("session", "gen-1", RestAction.EXTEND, 30, now));
        assertEquals(now + 70_000, tapped.deadlineMs);
        // A reloaded page restates the rest it remembers; the tap stays on top until the page takes it.
        RestSnapshot restated = store.saveRestSnapshotIfNewer(page("gen-1", now + 40_000, "page-b", 1));
        assertEquals(now + 70_000, restated.deadlineMs);
        assertEquals(1, store.takeRestActions().size());
        assertTrue(store.takeRestActions().isEmpty());
        // Once the page has made the change itself, its own rest stands.
        assertEquals(now + 70_000, store.saveRestSnapshotIfNewer(page("gen-2", now + 70_000, "page-b", 2)).deadlineMs);
    }

    @Test public void aTapForAReplacedRestIsDropped() {
        long now = System.currentTimeMillis();
        store.saveRestSnapshotIfNewer(page("gen-1", now + 40_000, "page-a", 1));
        store.applyRestAction(new RestAction("session", "gen-1", RestAction.SKIP, 0, now));
        RestSnapshot next = store.saveRestSnapshotIfNewer(page("gen-2", now + 90_000, "page-a", 2));
        assertEquals(RestSnapshot.RUNNING, next.status);
        assertTrue(store.takeRestActions().isEmpty());
        assertNull(store.applyRestAction(new RestAction("session", "gen-1", RestAction.SKIP, 0, now)));
    }

    @Test public void endingTheWorkoutForgetsPendingTaps() {
        long now = System.currentTimeMillis();
        store.saveRestSnapshotIfNewer(page("gen-1", now + 40_000, "page-a", 1));
        store.applyRestAction(new RestAction("session", "gen-1", RestAction.EXTEND, 30, now));
        store.clearRestSnapshot();
        assertNull(store.getRestSnapshot());
        assertTrue(store.takeRestActions().isEmpty());
    }

    @Test public void permissionGrantRearmsOnlyFutureRunningRests() {
        Context context = RuntimeEnvironment.getApplication();
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        long now = System.currentTimeMillis();
        store.saveRestSnapshotIfNewer(new RestSnapshot("session", "generation", RestSnapshot.RUNNING,
                now + 60000, 0, now, 0, 0, true, true, false, "epoch", 1));
        Intent grant = new Intent(AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED);
        new BootReceiver().onReceive(context, grant);
        assertEquals(1, Shadows.shadowOf(alarms).getScheduledAlarms().size());
        RestSchedule.cancel(context);
        store.saveRestSnapshotIfNewer(new RestSnapshot("session", "paused", RestSnapshot.PAUSED,
                0, 60000, now, now, 0, true, true, false, "epoch", 2));
        new BootReceiver().onReceive(context, grant);
        assertEquals(0, Shadows.shadowOf(alarms).getScheduledAlarms().size());
    }
}
