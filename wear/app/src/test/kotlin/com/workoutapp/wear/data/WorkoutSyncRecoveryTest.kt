package com.workoutapp.wear.data

import android.content.Context
import com.google.gson.GsonBuilder
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** Each case is a way the queue used to wedge, loop, or overwrite watch-only state. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class WorkoutSyncRecoveryTest {
    private lateinit var context: Context
    private lateinit var store: WorkoutStore
    private val gson = GsonBuilder().serializeNulls().create()

    @Before
    fun setUp() {
        context = RuntimeEnvironment.getApplication()
        context.deleteDatabase("workout-wear.db")
        context.getSharedPreferences("workout-wear-notices", Context.MODE_PRIVATE).edit().clear().commit()
        store = WorkoutStore(context)
    }

    @After
    fun tearDown() {
        store.close()
        context.deleteDatabase("workout-wear.db")
    }

    @Test
    fun `a refusal that is not a revision race goes to review instead of resending forever`() = runBlocking {
        val server = session(revision = 4)
        store.enqueue(snapshot(server), pause("pause-1", server))
        // The server keeps refusing at the same revision, as it does for an out-of-order timestamp.
        val gateway = ScriptedGateway(server) { throw ApiFailure(409, "Workout timing changes must be applied in order.") }

        val outcome = WorkoutSyncCoordinator(context, store, gateway).syncPending()

        assertTrue(outcome.conflict)
        assertEquals(1, gateway.sends)
        assertEquals("pause-1", store.readSnapshot()?.conflictOperationId)
    }

    @Test
    fun `a workout closed on the phone releases its queued edits and explains why`() = runBlocking {
        val server = session(revision = 4)
        store.enqueue(snapshot(server), setOperation("set-1", server, "s1"))
        store.enqueue(snapshot(server), setOperation("set-2", server, "s2"))
        val gateway = ScriptedGateway(server, lookupFailure = ApiFailure(404, "This workout is no longer active in WorkoutApp.")) {
            throw ApiFailure(409, "This workout is already saved to your history.")
        }

        val outcome = WorkoutSyncCoordinator(context, store, gateway).syncPending()

        assertFalse(outcome.pending)
        assertTrue(store.pendingOperations().isEmpty())
        assertNull(store.readSnapshot())
        assertTrue(store.notice.value!!.contains("2 changes"))
    }

    @Test
    fun `an edit WorkoutApp refuses is dropped so the edits behind it still sync`() = runBlocking {
        val server = session(revision = 4)
        store.enqueue(snapshot(server), setOperation("bad", server, "s1"))
        store.enqueue(snapshot(server), setOperation("good", server, "s2"))
        val gateway = ScriptedGateway(server) { operation ->
            if (operation.id == "bad") throw ApiFailure(400, "Reps are invalid.")
            server.copy(revision = 5)
        }

        val outcome = WorkoutSyncCoordinator(context, store, gateway).syncPending()

        assertFalse(outcome.pending)
        assertTrue(store.pendingOperations().isEmpty())
        assertEquals(listOf("bad", "good"), gateway.sentIds)
        assertEquals("Reps are invalid.", store.notice.value)
    }

    @Test
    fun `a set removed on the phone is released rather than sent to review`() = runBlocking {
        val server = session(revision = 4)
        store.enqueue(snapshot(server), setOperation("gone", server, "s2"))
        val withoutSet = server.copy(revision = 5, exercises = server.exercises.map { it.copy(sets = it.sets.take(1)) })
        val gateway = ScriptedGateway(withoutSet) { throw ApiFailure(404, "That set no longer exists.") }

        WorkoutSyncCoordinator(context, store, gateway).syncPending()

        assertTrue(store.pendingOperations().isEmpty())
        assertNull(store.readSnapshot()?.conflictOperationId)
        assertEquals(1, store.readSnapshot()?.session?.exercises?.single()?.sets?.size)
    }

    @Test
    fun `a rest started while a sync was in flight survives the acknowledgement`() = runBlocking {
        val server = session(revision = 4)
        store.enqueue(snapshot(server), setOperation("set-1", server, "s1"))
        val gateway = ScriptedGateway(server) {
            // The lifter starts a rest and moves on while the request is on the wire.
            store.update { current, _ -> current?.copy(restEndsAtEpochMs = 123_456L, restGeneration = "rest-9", activeExerciseId = "other") }
            server.copy(revision = 5)
        }

        WorkoutSyncCoordinator(context, store, gateway).syncPending()

        val after = store.readSnapshot()!!
        assertEquals(123_456L, after.restEndsAtEpochMs)
        assertEquals("rest-9", after.restGeneration)
        assertEquals("other", after.activeExerciseId)
        assertEquals(5, after.session.revision)
    }

    @Test
    fun `projection shows queued edits over the server copy and honours explicit clears`() {
        val server = session(revision = 4).let { base ->
            base.copy(exercises = base.exercises.map { exercise ->
                exercise.copy(sets = exercise.sets.map { it.copy(rpe = 9.0, rir = "1") })
            })
        }
        val clearing = setOperation("five-plus", server, "s1").copy(
            requestJson = """{"revision":4,"mutationId":"five-plus","reps":10,"rpe":null,"rir":"5+","done":true}"""
        )

        val projected = SessionProjection.project(server, listOf(clearing)).exercises.single().sets.first()

        assertTrue(projected.done)
        assertNull(projected.rpe)
        assertEquals("5+", projected.rir)
    }

    @Test
    fun `after logging a superset set the watch moves to the partner, not back to the first exercise`() {
        val a1 = WorkoutExercise(id = "a1", name = "Curl", position = 0, sequenceGroup = "A1",
            sets = listOf(WorkoutSet(id = "a1-1", position = 0, done = true), WorkoutSet(id = "a1-2", position = 1)))
        val a2 = WorkoutExercise(id = "a2", name = "Pushdown", position = 1, sequenceGroup = "A2",
            sets = listOf(WorkoutSet(id = "a2-1", position = 0), WorkoutSet(id = "a2-2", position = 1)))
        val workout = WorkoutSession(id = "w", exercises = listOf(a1, a2))

        assertEquals("a2", RestPolicy.nextExerciseId(workout, "a1", "a1-1"))
        assertFalse(RestPolicy.shouldRestAfter(workout, "a1", "a1-1"))
    }

    @Test
    fun `the store publishes every write to observers`() {
        val server = session(revision = 4)
        store.enqueue(snapshot(server), setOperation("set-1", server, "s1"))
        assertEquals(1, store.state.value.pending.size)
        assertNotNull(store.state.value.snapshot)

        store.clearAll()

        assertTrue(store.state.value.pending.isEmpty())
        assertNull(store.state.value.snapshot)
    }

    private fun session(revision: Int) = WorkoutSession(
        id = "workout-1",
        revision = revision,
        exercises = listOf(WorkoutExercise(
            id = "exercise-1",
            name = "Bench press",
            prescription = listOf(SetPrescription(8, 10), SetPrescription(8, 10)),
            sets = listOf(WorkoutSet(id = "s1", position = 0), WorkoutSet(id = "s2", position = 1))
        ))
    )

    private fun snapshot(session: WorkoutSession) = WorkoutSnapshot(session, "kg", 90, activeExerciseId = "exercise-1")

    private fun setOperation(id: String, baseline: WorkoutSession, setId: String) = PendingOperation(
        sequence = 0, id = id, type = "set", sessionId = baseline.id, setId = setId, revision = baseline.revision,
        requestJson = """{"revision":${baseline.revision},"mutationId":"$id","weightKg":60,"reps":8,"rpe":8,"rir":"2","done":true}""",
        baselineJson = gson.toJson(baseline), createdAt = "2026-09-25T10:00:00Z", attempted = false
    )

    private fun pause(id: String, baseline: WorkoutSession) = PendingOperation(
        sequence = 0, id = id, type = "pause", sessionId = baseline.id, revision = baseline.revision,
        requestJson = """{"revision":${baseline.revision},"mutationId":"$id","occurredAt":"2026-09-25T10:00:00Z"}""",
        baselineJson = gson.toJson(baseline), createdAt = "2026-09-25T10:00:00Z", attempted = false
    )

    private class ScriptedGateway(
        private val remote: WorkoutSession,
        private val lookupFailure: ApiFailure? = null,
        private val onSend: (PendingOperation) -> WorkoutSession
    ) : WorkoutGateway {
        var sends = 0
            private set
        val sentIds = mutableListOf<String>()

        override suspend fun startPairing(): PairingStart = error("Unused in this test")
        override suspend fun pairingStatus(pairingId: String): PairingStatus = error("Unused in this test")
        override suspend fun active(): ActiveWorkoutResponse = ActiveWorkoutResponse(session = remote)
        override suspend fun workout(sessionId: String): WorkoutSession = lookupFailure?.let { throw it } ?: remote
        override suspend fun revoke() = Unit
        override suspend fun send(operation: PendingOperation): WorkoutSession {
            sends++
            sentIds.add(operation.id)
            return onSend(operation)
        }
    }
}
