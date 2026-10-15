package com.workoutapp.phone;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteException;
import android.database.sqlite.SQLiteOpenHelper;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

public class WorkoutRecoveryStore {
    private static final String DB_NAME = "workout_recovery.db";
    private static final int DB_VERSION = 1;

    private static final String TABLE_RECOVERY = "workout_recovery";
    private static final String COL_ACCOUNT_ID = "account_id";
    private static final String COL_SESSION_ID = "session_id";
    private static final String COL_RECORD_JSON = "record_json";
    private static final String COL_UPDATED_AT = "updated_at";

    private static final String TABLE_META = "recovery_meta";
    private static final String COL_KEY = "key";
    private static final String COL_VALUE = "value";

    private static final String TABLE_ALERTS = "rest_alerts";
    private static final String COL_ALERT_SESSION_ID = "session_id";
    private static final String COL_ALERT_GENERATION = "generation";
    private static final String COL_ALERT_CLAIMED = "alert_claimed";
    private static final String COL_ALERT_CLAIMED_AT = "claimed_at";

    private static final String KEY_LAST_ACCOUNT = "last-account";
    private static final String KEY_REST_STATE = "rest-state";
    private static final String KEY_REST_ACTIONS = "rest-actions";
    // A claim only has to outlive the rest it silences; older ones are removed as new ones arrive.
    private static final long CLAIM_RETENTION_MS = 24L * 60 * 60 * 1000;

    private static WorkoutRecoveryStore instance;
    private final DBHelper helper;

    private WorkoutRecoveryStore(Context context) {
        File dbDir = context.getNoBackupFilesDir();
        File dbFile = new File(dbDir, DB_NAME);
        helper = new DBHelper(context, dbFile.getAbsolutePath());
    }

    public static synchronized WorkoutRecoveryStore get(Context context) {
        if (instance == null) {
            instance = new WorkoutRecoveryStore(context.getApplicationContext());
        }
        return instance;
    }

    public synchronized String getRecovery(String accountId) {
        if (accountId == null) return null;
        SQLiteDatabase db = helper.getReadableDatabase();
        try (Cursor cursor = db.query(TABLE_RECOVERY, new String[]{COL_RECORD_JSON},
                COL_ACCOUNT_ID + " = ?", new String[]{accountId}, null, null, null)) {
            if (cursor.moveToFirst()) {
                return cursor.getString(0);
            }
        }
        return null;
    }

    public synchronized void saveRecovery(String accountId, String sessionId, String recordJson) {
        if (accountId == null || recordJson == null) return;
        SQLiteDatabase db = helper.getWritableDatabase();
        ContentValues values = new ContentValues();
        values.put(COL_ACCOUNT_ID, accountId);
        values.put(COL_SESSION_ID, sessionId);
        values.put(COL_RECORD_JSON, recordJson);
        values.put(COL_UPDATED_AT, System.currentTimeMillis());
        insertOrFail(db, TABLE_RECOVERY, values);
    }

    public synchronized void deleteRecovery(String accountId) {
        if (accountId == null) return;
        SQLiteDatabase db = helper.getWritableDatabase();
        db.beginTransaction();
        try {
            List<RestAction> actions = getRestActions();
            actions.removeIf(action -> accountId.equals(action.accountId));
            db.delete(TABLE_RECOVERY, COL_ACCOUNT_ID + " = ?", new String[]{accountId});
            putMeta(db, KEY_REST_ACTIONS, RestAction.listToJson(actions));
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }

    public synchronized String getLastAccountId() {
        SQLiteDatabase db = helper.getReadableDatabase();
        try (Cursor cursor = db.query(TABLE_META, new String[]{COL_VALUE},
                COL_KEY + " = ?", new String[]{KEY_LAST_ACCOUNT}, null, null, null)) {
            if (cursor.moveToFirst()) {
                return cursor.getString(0);
            }
        }
        return null;
    }

    public synchronized void setLastAccountId(String accountId) {
        SQLiteDatabase db = helper.getWritableDatabase();
        if (accountId == null) {
            db.delete(TABLE_META, COL_KEY + " = ?", new String[]{KEY_LAST_ACCOUNT});
        } else {
            ContentValues values = new ContentValues();
            values.put(COL_KEY, KEY_LAST_ACCOUNT);
            values.put(COL_VALUE, accountId);
            insertOrFail(db, TABLE_META, values);
        }
    }

    public synchronized RestSnapshot getRestSnapshot() {
        SQLiteDatabase db = helper.getReadableDatabase();
        try (Cursor cursor = db.query(TABLE_META, new String[]{COL_VALUE},
                COL_KEY + " = ?", new String[]{KEY_REST_STATE}, null, null, null)) {
            return cursor.moveToFirst() ? RestSnapshot.fromJson(cursor.getString(0)) : null;
        }
    }

    /// Stores the page's snapshot unless it is older than the one already stored. Notification
    /// actions the page has not taken yet are laid over it, so a page that restates an older view
    /// of the same rest cannot undo a tap; actions for any other rest are dropped. Returns what was
    /// stored, or null when the snapshot was older.
    public synchronized RestSnapshot saveRestSnapshotIfNewer(RestSnapshot snapshot) {
        if (!snapshot.supersedes(getRestSnapshot())) return null;
        List<RestAction> pending = getRestActions();
        RestSnapshot stored = RestAction.overlay(snapshot, pending);
        putRest(stored, pending);
        return stored;
    }

    /// Applies a notification action to the stored rest and keeps it for the page. Returns the new
    /// rest, or null when the action is for a rest that is no longer stored.
    public synchronized RestSnapshot applyRestAction(RestAction action) {
        RestSnapshot current = getRestSnapshot();
        RestSnapshot beforeMigration = current;
        List<RestAction> pending = getRestActions();
        current = getRestSnapshot();
        if (!action.belongsTo(current) && action.belongsTo(beforeMigration) && current != null &&
                beforeMigration.sessionId.equals(current.sessionId)) {
            action = new RestAction(action.sessionId, current.generation, action.kind, action.seconds, action.atMs);
        }
        if (!action.belongsTo(current) || !(current.isRunning() || current.isPaused())) return null;
        String accountId = ownerOf(action.sessionId);
        if (accountId == null) return null;
        RestAction accepted = new RestAction(action.sessionId, action.generation, action.kind, action.seconds,
                action.atMs, UUID.randomUUID().toString(), accountId, UUID.randomUUID().toString());
        pending.add(accepted);
        RestSnapshot updated = accepted.applyTo(current);
        putRest(updated, pending);
        return updated;
    }

    /// Non-destructive read. Legacy identities are assigned and persisted once, before delivery.
    public synchronized List<RestAction> getRestActions() {
        List<RestAction> actions = RestAction.listFromJson(getMeta(KEY_REST_ACTIONS));
        if (actions.stream().noneMatch(action -> action.id.isEmpty())) return actions;
        List<RestAction> migrated = new ArrayList<>();
        RestSnapshot nativeRest = getRestSnapshot();
        String previousSource = null;
        String previousResult = null;
        String previousSession = null;
        for (RestAction action : actions) {
            if (!action.id.isEmpty()) { migrated.add(action); continue; }
            String owner = ownerOf(action.sessionId);
            if (owner == null) continue;
            String source = action.sessionId.equals(previousSession) && action.generation.equals(previousSource)
                    ? previousResult : action.generation;
            String result = UUID.randomUUID().toString();
            migrated.add(new RestAction(action.sessionId, source, action.kind, action.seconds, action.atMs,
                    UUID.randomUUID().toString(), owner, result));
            previousSource = action.generation;
            previousSession = action.sessionId;
            previousResult = result;
            // Legacy native snapshots already include the deltas. Only advance their identity.
            if (nativeRest != null && nativeRest.isCurrent(action.sessionId, action.generation))
                nativeRest = nativeRest.withGeneration(result);
            else if (nativeRest != null && nativeRest.isCurrent(action.sessionId, source))
                nativeRest = nativeRest.withGeneration(result);
        }
        SQLiteDatabase db = helper.getWritableDatabase();
        db.beginTransaction();
        try {
            putMeta(db, KEY_REST_ACTIONS, RestAction.listToJson(migrated));
            if (nativeRest != null) putMeta(db, KEY_REST_STATE, nativeRest.toJson());
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
        return migrated;
    }

    private String ownerOf(String sessionId) {
        try (Cursor cursor = helper.getReadableDatabase().query(TABLE_RECOVERY, new String[]{COL_ACCOUNT_ID},
                COL_SESSION_ID + " = ?", new String[]{sessionId}, null, null, null)) {
            if (!cursor.moveToFirst()) return null;
            String owner = cursor.getString(0);
            return cursor.moveToNext() ? null : owner;
        }
    }

    /// Compare the entire recovery revision, then import and acknowledge in one SQLite commit.
    public synchronized boolean importRestActions(String accountId, String sessionId, String expectedJson,
                                                  String updatedJson, List<String> importedIds) {
        SQLiteDatabase db = helper.getWritableDatabase();
        db.beginTransaction();
        try {
            if (!Objects.equals(expectedJson, getRecovery(accountId)) || expectedJson == null) return false;
            List<RestAction> pending = getRestActions();
            for (String id : importedIds) {
                RestAction action = pending.stream().filter(item -> item.id.equals(id)).findFirst().orElse(null);
                if (action == null || !action.accountId.equals(accountId) || !action.sessionId.equals(sessionId)) return false;
            }
            saveRecovery(accountId, sessionId, updatedJson);
            pending.removeIf(action -> importedIds.contains(action.id));
            putMeta(db, KEY_REST_ACTIONS, RestAction.listToJson(pending));
            db.setTransactionSuccessful();
            return true;
        } finally { db.endTransaction(); }
    }

    public synchronized void clearRestSnapshot() {
        // Stopping the service also happens on account switches. Only deleting that account's
        // recovery record acknowledges clearing its pending actions with the workout.
        helper.getWritableDatabase().delete(TABLE_META, COL_KEY + " = ?", new String[]{KEY_REST_STATE});
    }

    private String getMeta(String key) {
        SQLiteDatabase db = helper.getReadableDatabase();
        try (Cursor cursor = db.query(TABLE_META, new String[]{COL_VALUE}, COL_KEY + " = ?", new String[]{key}, null, null, null)) {
            return cursor.moveToFirst() ? cursor.getString(0) : null;
        }
    }

    /// The rest and the actions laid over it are written together, so neither is ever seen without the other.
    private void putRest(RestSnapshot snapshot, List<RestAction> pending) {
        SQLiteDatabase db = helper.getWritableDatabase();
        db.beginTransaction();
        try {
            putMeta(db, KEY_REST_STATE, snapshot.toJson());
            putMeta(db, KEY_REST_ACTIONS, RestAction.listToJson(pending));
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    private static void putMeta(SQLiteDatabase db, String key, String value) {
        if (value == null) throw new SQLiteException("Workout recovery could not be saved.");
        ContentValues values = new ContentValues();
        values.put(COL_KEY, key);
        values.put(COL_VALUE, value);
        insertOrFail(db, TABLE_META, values);
    }

    public synchronized boolean claimRestAlert(String sessionId, String generation) {
        if (sessionId == null || generation == null || generation.isEmpty()) return false;
        SQLiteDatabase db = helper.getWritableDatabase();
        db.beginTransaction();
        try {
            db.delete(TABLE_ALERTS, COL_ALERT_CLAIMED_AT + " < ?",
                    new String[]{String.valueOf(System.currentTimeMillis() - CLAIM_RETENTION_MS)});
            try (Cursor cursor = db.query(TABLE_ALERTS, new String[]{COL_ALERT_CLAIMED},
                    COL_ALERT_SESSION_ID + " = ? AND " + COL_ALERT_GENERATION + " = ?",
                    new String[]{sessionId, generation}, null, null, null)) {
                if (cursor.moveToFirst()) {
                    if (cursor.getInt(0) == 1) {
                        db.setTransactionSuccessful();
                        return false;
                    }
                }
            }

            ContentValues values = new ContentValues();
            values.put(COL_ALERT_SESSION_ID, sessionId);
            values.put(COL_ALERT_GENERATION, generation);
            values.put(COL_ALERT_CLAIMED, 1);
            values.put(COL_ALERT_CLAIMED_AT, System.currentTimeMillis());
            long rowId = db.insertWithOnConflict(TABLE_ALERTS, null, values, SQLiteDatabase.CONFLICT_REPLACE);
            db.setTransactionSuccessful();
            return rowId != -1;
        } finally {
            db.endTransaction();
        }
    }

    private static void insertOrFail(SQLiteDatabase db, String table, ContentValues values) {
        if (db.insertWithOnConflict(table, null, values, SQLiteDatabase.CONFLICT_REPLACE) == -1) {
            throw new SQLiteException("Workout recovery could not be saved.");
        }
    }

    private static class DBHelper extends SQLiteOpenHelper {
        DBHelper(Context context, String path) {
            super(context, path, null, DB_VERSION);
        }

        @Override
        public void onCreate(SQLiteDatabase db) {
            db.execSQL("CREATE TABLE " + TABLE_RECOVERY + " (" +
                    COL_ACCOUNT_ID + " TEXT PRIMARY KEY, " +
                    COL_SESSION_ID + " TEXT, " +
                    COL_RECORD_JSON + " TEXT, " +
                    COL_UPDATED_AT + " INTEGER)");

            db.execSQL("CREATE TABLE " + TABLE_META + " (" +
                    COL_KEY + " TEXT PRIMARY KEY, " +
                    COL_VALUE + " TEXT)");

            db.execSQL("CREATE TABLE " + TABLE_ALERTS + " (" +
                    COL_ALERT_SESSION_ID + " TEXT, " +
                    COL_ALERT_GENERATION + " TEXT, " +
                    COL_ALERT_CLAIMED + " INTEGER, " +
                    COL_ALERT_CLAIMED_AT + " INTEGER, " +
                    "PRIMARY KEY (" + COL_ALERT_SESSION_ID + ", " + COL_ALERT_GENERATION + "))");
        }

        @Override
        public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        }
    }
}
