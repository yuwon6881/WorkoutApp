package com.workoutapp.phone;

import static org.junit.Assert.*;
import android.content.Context;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import java.io.File;
import java.lang.reflect.Field;
import java.util.Collections;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class RestActionImportTest {
    private WorkoutRecoveryStore store;
    private SQLiteOpenHelper helper;
    private SQLiteDatabase db;

    @Before public void open() throws Exception {
        Field singleton = WorkoutRecoveryStore.class.getDeclaredField("instance");
        singleton.setAccessible(true);
        singleton.set(null, null);
        Context context = RuntimeEnvironment.getApplication();
        new File(context.getNoBackupFilesDir(), "workout_recovery.db").delete();
        store = WorkoutRecoveryStore.get(context);
        Field field = WorkoutRecoveryStore.class.getDeclaredField("helper");
        field.setAccessible(true);
        helper = (SQLiteOpenHelper) field.get(store);
        db = helper.getWritableDatabase();
        store.saveRecovery("account", "session", "{\"revision\":1}");
        store.saveRestSnapshotIfNewer(new RestSnapshot("session", "g", RestSnapshot.RUNNING,
                100000, 0, 1, 0, 0, true, true, false, "epoch", 1));
    }

    @After public void close() { helper.close(); }

    private RestAction tap() {
        RestSnapshot current = store.getRestSnapshot();
        store.applyRestAction(new RestAction("session", current.generation, RestAction.EXTEND, 30, 1000));
        return store.getRestActions().get(store.getRestActions().size() - 1);
    }

    @Test public void readsSurviveCrashAndKeepStableIdentities() {
        RestAction action = tap();
        assertEquals(action.id, store.getRestActions().get(0).id);
        assertEquals("account", action.accountId);
        assertEquals("g", action.generation);
        assertEquals(action.resultingGeneration, store.getRestSnapshot().generation);
        assertEquals(1000, store.getRestActions().get(0).atMs);
    }

    @Test public void staleImportChangesNeitherRecordNorActions() {
        RestAction action = tap();
        assertFalse(store.importRestActions("account", "session", "stale", "next", Collections.singletonList(action.id)));
        assertEquals("{\"revision\":1}", store.getRecovery("account"));
        assertEquals(1, store.getRestActions().size());
    }

    @Test public void failedImportRollsBackAndCanBeRetried() {
        RestAction action = tap();
        db.execSQL("CREATE TRIGGER fail_import BEFORE INSERT ON workout_recovery BEGIN SELECT RAISE(ABORT, 'full'); END");
        assertThrows(RuntimeException.class, () -> store.importRestActions("account", "session",
                "{\"revision\":1}", "next", Collections.singletonList(action.id)));
        assertEquals(1, store.getRestActions().size());
        assertEquals("{\"revision\":1}", store.getRecovery("account"));
        db.execSQL("DROP TRIGGER fail_import");
        assertTrue(store.importRestActions("account", "session", "{\"revision\":1}", "next", Collections.singletonList(action.id)));
        assertEquals("next", store.getRecovery("account"));
        assertTrue(store.getRestActions().isEmpty());
    }

    @Test public void importRemovesOnlySelectedActionsAndNeverAnotherAccount() {
        RestAction first = tap();
        tap();
        assertFalse(store.importRestActions("other", "session", null, "wrong", Collections.singletonList(first.id)));
        assertTrue(store.importRestActions("account", "session", "{\"revision\":1}", "next", Collections.singletonList(first.id)));
        assertEquals(1, store.getRestActions().size());
        assertNotEquals(first.id, store.getRestActions().get(0).id);
    }

    @Test public void moreThanTwentyActionsRemainDurable() {
        for (int i = 0; i < 25; i++) tap();
        assertEquals(25, store.getRestActions().size());
        assertEquals(850000, store.getRestSnapshot().deadlineMs);
    }

    @Test public void legacyActionsMigrateOnceWithoutReapplyingNativeDeltas() {
        db.execSQL("INSERT OR REPLACE INTO recovery_meta(key,value) VALUES ('rest-actions', ?)",
                new Object[]{"[{\"sessionId\":\"session\",\"generation\":\"g\",\"kind\":\"extend\",\"seconds\":30,\"atMs\":1000},"
                        + "{\"sessionId\":\"session\",\"generation\":\"g\",\"kind\":\"extend\",\"seconds\":30,\"atMs\":2000}]"});
        java.util.List<RestAction> migrated = store.getRestActions();
        assertEquals(2, migrated.size());
        assertEquals("account", migrated.get(0).accountId);
        assertEquals(migrated.get(0).resultingGeneration, migrated.get(1).generation);
        assertEquals(migrated.get(1).resultingGeneration, store.getRestSnapshot().generation);
        assertEquals(100000, store.getRestSnapshot().deadlineMs);
        assertEquals(migrated.get(0).id, store.getRestActions().get(0).id);
        assertEquals(2000, store.getRestActions().get(1).atMs);
    }

    @Test public void ambiguousLegacyOwnershipCannotMoveActionsAcrossAccounts() {
        store.saveRecovery("another-account", "session", "{}");
        db.execSQL("INSERT OR REPLACE INTO recovery_meta(key,value) VALUES ('rest-actions', ?)",
                new Object[]{"[{\"sessionId\":\"session\",\"generation\":\"g\",\"kind\":\"extend\",\"seconds\":30,\"atMs\":1000}]"});
        assertTrue(store.getRestActions().isEmpty());
        assertNull(store.applyRestAction(new RestAction("session", "g", RestAction.EXTEND, 30, 1000)));
    }

    @Test public void failureSavingAnActionRollsBackTheNativeTransition() {
        db.execSQL("CREATE TRIGGER fail_action BEFORE INSERT ON recovery_meta "
                + "WHEN NEW.key = 'rest-actions' BEGIN SELECT RAISE(ABORT, 'full'); END");
        assertThrows(RuntimeException.class, () -> tap());
        assertEquals(100000, store.getRestSnapshot().deadlineMs);
        assertTrue(store.getRestActions().isEmpty());
    }
}
