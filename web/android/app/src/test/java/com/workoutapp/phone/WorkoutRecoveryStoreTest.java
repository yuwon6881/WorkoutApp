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
