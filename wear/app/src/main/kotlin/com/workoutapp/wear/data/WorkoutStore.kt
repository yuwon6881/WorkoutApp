package com.workoutapp.wear.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import com.google.gson.GsonBuilder
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The watch's durable copy of the live workout and its ordered edit queue. Every write publishes the
 * new state, and read-modify-write goes through [update] so a sync finishing mid-rest can never
 * overwrite a rest timer or exercise choice made while its request was in flight.
 */
class WorkoutStore(context: Context) : SQLiteOpenHelper(context.applicationContext, DATABASE_NAME, null, DATABASE_VERSION) {
    private val gson = GsonBuilder().serializeNulls().create()
    private val notices = context.applicationContext.getSharedPreferences(NOTICE_PREFERENCES, Context.MODE_PRIVATE)
    private val mutableState = MutableStateFlow(StoreState())
    private val mutableNotice = MutableStateFlow<String?>(null)
    private var loaded = false

    /** The current snapshot and queue; collected by screens and the ongoing-activity service. */
    val state: StateFlow<StoreState>
        get() {
            ensureLoaded()
            return mutableState.asStateFlow()
        }

    /** A one-off explanation for something sync did out of sight, such as dropping edits WorkoutApp refused. */
    val notice: StateFlow<String?>
        get() {
            ensureLoaded()
            return mutableNotice.asStateFlow()
        }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("""CREATE TABLE workout_state (
            id INTEGER PRIMARY KEY CHECK (id = 1), session_json TEXT NOT NULL, unit TEXT NOT NULL,
            default_rest_seconds INTEGER NOT NULL, active_exercise_id TEXT, rest_ends_at INTEGER,
            paused_rest_remaining_ms INTEGER, rest_generation TEXT, alerted_rest_generation TEXT, conflict_operation_id TEXT,
            conflict_session_json TEXT, pending_finish INTEGER NOT NULL DEFAULT 0, last_logged_set_id TEXT
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
        if (oldVersion < 4 && !hasColumn(db, "workout_state", "last_logged_set_id")) {
            db.execSQL("ALTER TABLE workout_state ADD COLUMN last_logged_set_id TEXT")
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
            pendingFinish = cursor.getInt(cursor.getColumnIndexOrThrow("pending_finish")) != 0,
            lastLoggedSetId = cursor.stringOrNull("last_logged_set_id")
        )
    }

    @Synchronized
    fun saveSnapshot(snapshot: WorkoutSnapshot) {
        writableDatabase.insertWithOnConflict("workout_state", null, snapshotValues(snapshot), SQLiteDatabase.CONFLICT_REPLACE)
        publish()
    }

    /** Atomic read-modify-write of the snapshot; [transform] sees the queue as it stands at this instant. */
    @Synchronized
    fun update(transform: (WorkoutSnapshot?, List<PendingOperation>) -> WorkoutSnapshot?): WorkoutSnapshot? {
        val current = readSnapshot()
        val next = transform(current, pendingOperations())
        if (next == null) {
            if (current != null) writableDatabase.delete("workout_state", null, null)
        } else if (next != current) {
            writableDatabase.insertWithOnConflict("workout_state", null, snapshotValues(next), SQLiteDatabase.CONFLICT_REPLACE)
        }
        publish()
        return next
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
        publish()
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
        publish()
    }

    /** Drops a confirmed operation and adopts the server's copy, keeping every watch-only field current. */
    @Synchronized
    fun acknowledge(sequence: Long, transform: (WorkoutSnapshot, List<PendingOperation>) -> WorkoutSnapshot) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            db.delete("workout_operations", "sequence = ?", arrayOf(sequence.toString()))
            readSnapshot()?.let { current ->
                db.insertWithOnConflict("workout_state", null, snapshotValues(transform(current, pendingOperations())),
                    SQLiteDatabase.CONFLICT_REPLACE)
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
        publish()
    }

    @Synchronized
    fun setConflict(operationId: String, remote: WorkoutSession) {
        update { snapshot, _ -> snapshot?.copy(conflictOperationId = operationId, conflictSession = remote) }
    }

    @Synchronized
    fun removeOperation(sequence: Long) {
        writableDatabase.delete("workout_operations", "sequence = ?", arrayOf(sequence.toString()))
        publish()
    }

    @Synchronized
    fun claimRestAlert(generation: String): Boolean {
        val values = ContentValues().apply {
            putNull("rest_ends_at")
            putNull("rest_generation")
            put("alerted_rest_generation", generation)
        }
        val claimed = writableDatabase.update(
            "workout_state",
            values,
            "id = 1 AND rest_generation = ? AND (alerted_rest_generation IS NULL OR alerted_rest_generation <> ?)",
            arrayOf(generation, generation)
        ) == 1
        if (claimed) publish()
        return claimed
    }

    @Synchronized
    fun clearAll() {
        writableDatabase.delete("workout_operations", null, null)
        writableDatabase.delete("workout_state", null, null)
        publish()
    }

    @Synchronized
    fun postNotice(text: String) {
        notices.edit().putString(NOTICE_KEY, text).apply()
        mutableNotice.value = text
    }

    @Synchronized
    fun clearNotice() {
        notices.edit().remove(NOTICE_KEY).apply()
        mutableNotice.value = null
    }

    @Synchronized
    private fun ensureLoaded() {
        if (loaded) return
        loaded = true
        mutableNotice.value = notices.getString(NOTICE_KEY, null)
        publish()
    }

    private fun publish() {
        loaded = true
        mutableState.value = StoreState(readSnapshot(), pendingOperations())
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
        put("last_logged_set_id", snapshot.lastLoggedSetId)
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
        private const val DATABASE_VERSION = 4
        private const val NOTICE_PREFERENCES = "workout-wear-notices"
        private const val NOTICE_KEY = "sync-notice"

        @Volatile private var shared: WorkoutStore? = null

        /** One store per process: the activity, sync worker and ongoing service must share one lock and one state. */
        fun get(context: Context): WorkoutStore = shared ?: synchronized(this) {
            shared ?: WorkoutStore(context.applicationContext).also { shared = it }
        }
    }
}
