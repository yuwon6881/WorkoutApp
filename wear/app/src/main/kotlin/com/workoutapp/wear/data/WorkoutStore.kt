package com.workoutapp.wear.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import com.google.gson.Gson
import com.google.gson.GsonBuilder

class WorkoutStore(context: Context) : SQLiteOpenHelper(context, DATABASE_NAME, null, DATABASE_VERSION) {
    private val gson = GsonBuilder().serializeNulls().create()

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("""CREATE TABLE workout_state (
            id INTEGER PRIMARY KEY CHECK (id = 1), session_json TEXT NOT NULL, unit TEXT NOT NULL,
            default_rest_seconds INTEGER NOT NULL, active_exercise_id TEXT, rest_ends_at INTEGER,
            paused_rest_remaining_ms INTEGER, rest_generation TEXT, alerted_rest_generation TEXT, conflict_operation_id TEXT,
            conflict_session_json TEXT, pending_finish INTEGER NOT NULL DEFAULT 0
        )""".trimIndent())
        db.execSQL("""CREATE TABLE workout_operations (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, type TEXT NOT NULL,
            session_id TEXT NOT NULL, set_id TEXT, revision INTEGER NOT NULL, request_json TEXT NOT NULL,
            baseline_json TEXT NOT NULL, created_at TEXT NOT NULL, attempted INTEGER NOT NULL DEFAULT 0
        )""".trimIndent())
        db.execSQL("CREATE INDEX ix_workout_operations_order ON workout_operations(sequence)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 3 && !hasColumn(db, "workout_state", "paused_rest_remaining_ms")) {
            db.execSQL("ALTER TABLE workout_state ADD COLUMN paused_rest_remaining_ms INTEGER")
        }
    }

    @Synchronized
    fun readSnapshot(): WorkoutSnapshot? = readableDatabase.query(
        "workout_state", null, "id = 1", null, null, null, null
    ).use { cursor ->
        if (!cursor.moveToFirst()) return null
        WorkoutSnapshot(
            session = gson.fromJson(cursor.getString(cursor.getColumnIndexOrThrow("session_json")), WorkoutSession::class.java),
            unit = cursor.getString(cursor.getColumnIndexOrThrow("unit")),
            defaultRestSeconds = cursor.getInt(cursor.getColumnIndexOrThrow("default_rest_seconds")),
            activeExerciseId = cursor.stringOrNull("active_exercise_id"),
            restEndsAtEpochMs = cursor.longOrNull("rest_ends_at"),
            pausedRestRemainingMs = cursor.longOrNull("paused_rest_remaining_ms"),
            restGeneration = cursor.stringOrNull("rest_generation"),
            alertedRestGeneration = cursor.stringOrNull("alerted_rest_generation"),
            conflictOperationId = cursor.stringOrNull("conflict_operation_id"),
            conflictSession = cursor.stringOrNull("conflict_session_json")?.let { gson.fromJson(it, WorkoutSession::class.java) },
            pendingFinish = cursor.getInt(cursor.getColumnIndexOrThrow("pending_finish")) != 0
        )
    }

    @Synchronized
    fun saveSnapshot(snapshot: WorkoutSnapshot) {
        writableDatabase.insertWithOnConflict("workout_state", null, snapshotValues(snapshot), SQLiteDatabase.CONFLICT_REPLACE)
    }

    @Synchronized
    fun enqueue(snapshot: WorkoutSnapshot, operation: PendingOperation) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            db.insertWithOnConflict("workout_state", null, snapshotValues(snapshot), SQLiteDatabase.CONFLICT_REPLACE)
            db.insertOrThrow("workout_operations", null, operationValues(operation))
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    @Synchronized
    fun pendingOperations(): List<PendingOperation> = readableDatabase.query(
        "workout_operations", null, null, null, null, null, "sequence ASC"
    ).use { cursor ->
        buildList {
            while (cursor.moveToNext()) add(
                PendingOperation(
                    sequence = cursor.getLong(cursor.getColumnIndexOrThrow("sequence")),
                    id = cursor.getString(cursor.getColumnIndexOrThrow("id")),
                    type = cursor.getString(cursor.getColumnIndexOrThrow("type")),
                    sessionId = cursor.getString(cursor.getColumnIndexOrThrow("session_id")),
                    setId = cursor.stringOrNull("set_id"),
                    revision = cursor.getInt(cursor.getColumnIndexOrThrow("revision")),
                    requestJson = cursor.getString(cursor.getColumnIndexOrThrow("request_json")),
                    baselineJson = cursor.getString(cursor.getColumnIndexOrThrow("baseline_json")),
                    createdAt = cursor.getString(cursor.getColumnIndexOrThrow("created_at")),
                    attempted = cursor.getInt(cursor.getColumnIndexOrThrow("attempted")) != 0
                )
            )
        }
    }

    @Synchronized
    fun markAttempted(sequence: Long) {
        writableDatabase.update("workout_operations", ContentValues().apply { put("attempted", 1) }, "sequence = ?", arrayOf(sequence.toString()))
    }

    @Synchronized
    fun rewriteOperation(sequence: Long, id: String, revision: Int, requestJson: String, baselineJson: String) {
        val values = ContentValues().apply {
            put("id", id)
            put("revision", revision)
            put("request_json", requestJson)
            put("baseline_json", baselineJson)
            put("attempted", 0)
        }
        writableDatabase.update("workout_operations", values, "sequence = ?", arrayOf(sequence.toString()))
    }

    @Synchronized
    fun acknowledge(sequence: Long, snapshot: WorkoutSnapshot) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            db.delete("workout_operations", "sequence = ?", arrayOf(sequence.toString()))
            db.insertWithOnConflict("workout_state", null, snapshotValues(snapshot), SQLiteDatabase.CONFLICT_REPLACE)
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    @Synchronized
    fun setConflict(operationId: String, remote: WorkoutSession) {
        val snapshot = readSnapshot() ?: return
        saveSnapshot(snapshot.copy(conflictOperationId = operationId, conflictSession = remote))
    }

    @Synchronized
    fun clearConflict(snapshot: WorkoutSnapshot) = saveSnapshot(snapshot.copy(conflictOperationId = null, conflictSession = null))

    @Synchronized
    fun removeOperation(sequence: Long) {
        writableDatabase.delete("workout_operations", "sequence = ?", arrayOf(sequence.toString()))
    }

    @Synchronized
    fun saveRestDeadline(deadlineEpochMs: Long, generation: String) {
        val snapshot = readSnapshot() ?: return
        saveSnapshot(snapshot.copy(restEndsAtEpochMs = deadlineEpochMs, restGeneration = generation, alertedRestGeneration = null))
    }

    @Synchronized
    fun clearRest() {
        val snapshot = readSnapshot() ?: return
        saveSnapshot(snapshot.copy(restEndsAtEpochMs = null, restGeneration = null, alertedRestGeneration = null))
    }

    @Synchronized
    fun claimRestAlert(generation: String): Boolean {
        val values = ContentValues().apply {
            putNull("rest_ends_at")
            putNull("rest_generation")
            put("alerted_rest_generation", generation)
        }
        return writableDatabase.update(
            "workout_state",
            values,
            "id = 1 AND rest_generation = ? AND (alerted_rest_generation IS NULL OR alerted_rest_generation <> ?)",
            arrayOf(generation, generation)
        ) == 1
    }

    @Synchronized
    fun clearAll() {
        writableDatabase.delete("workout_operations", null, null)
        writableDatabase.delete("workout_state", null, null)
    }

    private fun snapshotValues(snapshot: WorkoutSnapshot) = ContentValues().apply {
        put("id", 1)
        put("session_json", gson.toJson(snapshot.session))
        put("unit", snapshot.unit)
        put("default_rest_seconds", snapshot.defaultRestSeconds)
        put("active_exercise_id", snapshot.activeExerciseId)
        put("rest_ends_at", snapshot.restEndsAtEpochMs)
        put("paused_rest_remaining_ms", snapshot.pausedRestRemainingMs)
        put("rest_generation", snapshot.restGeneration)
        put("alerted_rest_generation", snapshot.alertedRestGeneration)
        put("conflict_operation_id", snapshot.conflictOperationId)
        put("conflict_session_json", snapshot.conflictSession?.let(gson::toJson))
        put("pending_finish", if (snapshot.pendingFinish) 1 else 0)
    }

    private fun operationValues(operation: PendingOperation) = ContentValues().apply {
        put("id", operation.id)
        put("type", operation.type)
        put("session_id", operation.sessionId)
        put("set_id", operation.setId)
        put("revision", operation.revision)
        put("request_json", operation.requestJson)
        put("baseline_json", operation.baselineJson)
        put("created_at", operation.createdAt)
        put("attempted", if (operation.attempted) 1 else 0)
    }

    private fun hasColumn(db: SQLiteDatabase, table: String, column: String): Boolean =
        db.rawQuery("PRAGMA table_info($table)", null).use { cursor ->
            val nameColumn = cursor.getColumnIndexOrThrow("name")
            while (cursor.moveToNext()) if (cursor.getString(nameColumn) == column) return@use true
            false
        }

    private fun android.database.Cursor.stringOrNull(column: String): String? {
        val index = getColumnIndexOrThrow(column)
        return if (isNull(index)) null else getString(index)
    }

    private fun android.database.Cursor.longOrNull(column: String): Long? {
        val index = getColumnIndexOrThrow(column)
        return if (isNull(index)) null else getLong(index)
    }

    companion object {
        private const val DATABASE_NAME = "workout-wear.db"
        private const val DATABASE_VERSION = 3
    }
}
