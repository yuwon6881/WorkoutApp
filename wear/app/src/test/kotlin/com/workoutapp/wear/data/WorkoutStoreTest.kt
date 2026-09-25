package com.workoutapp.wear.data

import android.content.Context
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class WorkoutStoreTest {
    private lateinit var context: Context

    @Before
    fun setUp() {
        context = RuntimeEnvironment.getApplication()
        context.deleteDatabase("workout-wear.db")
    }

    @After
    fun tearDown() {
        context.deleteDatabase("workout-wear.db")
    }

    @Test
    fun `pending operations and rest time survive a store restart in order`() {
        val store = WorkoutStore(context)
        val snapshot = snapshot().copy(
            restEndsAtEpochMs = 9_000_000L,
            pausedRestRemainingMs = 25_000L,
            restGeneration = "rest-1"
        )
        store.enqueue(snapshot, operation("op-1", 1))
        store.enqueue(snapshot, operation("op-2", 2))
        store.close()

        val restarted = WorkoutStore(context)
        try {
            assertEquals(listOf("op-1", "op-2"), restarted.pendingOperations().map { it.id })
            assertEquals(9_000_000L, restarted.readSnapshot()?.restEndsAtEpochMs)
            assertEquals(25_000L, restarted.readSnapshot()?.pausedRestRemainingMs)
            assertEquals("rest-1", restarted.readSnapshot()?.restGeneration)
        } finally {
            restarted.close()
        }
    }

    @Test
    fun `only one rest-expiry callback can claim a persisted alert generation`() {
        val first = WorkoutStore(context)
        first.saveSnapshot(snapshot().copy(restEndsAtEpochMs = 9_000_000L, restGeneration = "rest-1"))
        val second = WorkoutStore(context)
        try {
            assertTrue(first.claimRestAlert("rest-1"))
            assertFalse(second.claimRestAlert("rest-1"))
            val saved = second.readSnapshot()!!
            assertNull(saved.restEndsAtEpochMs)
            assertNull(saved.restGeneration)
            assertEquals("rest-1", saved.alertedRestGeneration)
        } finally {
            first.close()
            second.close()
        }
    }

    @Test
    fun `version two databases gain the pause-rest remainder column`() {
        val database = context.openOrCreateDatabase("workout-wear.db", Context.MODE_PRIVATE, null)
        database.execSQL("""CREATE TABLE workout_state (
            id INTEGER PRIMARY KEY CHECK (id = 1), session_json TEXT NOT NULL, unit TEXT NOT NULL,
            default_rest_seconds INTEGER NOT NULL, active_exercise_id TEXT, rest_ends_at INTEGER,
            rest_generation TEXT, alerted_rest_generation TEXT, conflict_operation_id TEXT,
            conflict_session_json TEXT, pending_finish INTEGER NOT NULL DEFAULT 0
        )""")
        database.version = 2
        database.close()

        val upgraded = WorkoutStore(context)
        try {
            assertNull(upgraded.readSnapshot())
        } finally {
            upgraded.close()
        }
    }

    private fun snapshot() = WorkoutSnapshot(
        session = WorkoutSession(id = "workout-1", revision = 4),
        unit = "kg",
        defaultRestSeconds = 90
    )

    private fun operation(id: String, position: Int) = PendingOperation(
        sequence = position.toLong(),
        id = id,
        type = "set",
        sessionId = "workout-1",
        setId = "set-$position",
        revision = 4,
        requestJson = "{}",
        baselineJson = "{}",
        createdAt = "2026-09-25T10:00:00Z",
        attempted = false
    )
}
