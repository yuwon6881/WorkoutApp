package com.workoutapp.phone;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteException;
import android.database.sqlite.SQLiteOpenHelper;
import java.io.File;

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
        db.delete(TABLE_RECOVERY, COL_ACCOUNT_ID + " = ?", new String[]{accountId});
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

    /// Stores the snapshot unless it is older than the one already stored; reports whether it did.
    public synchronized boolean saveRestSnapshotIfNewer(RestSnapshot snapshot) {
        String json = snapshot.toJson();
        if (json == null || !snapshot.supersedes(getRestSnapshot())) return false;
        ContentValues values = new ContentValues();
        values.put(COL_KEY, KEY_REST_STATE);
        values.put(COL_VALUE, json);
        insertOrFail(helper.getWritableDatabase(), TABLE_META, values);
        return true;
    }

    public synchronized void clearRestSnapshot() {
        helper.getWritableDatabase().delete(TABLE_META, COL_KEY + " = ?", new String[]{KEY_REST_STATE});
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
