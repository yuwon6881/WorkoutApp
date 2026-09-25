package com.workoutapp.wear.data

import android.content.Context
import com.google.gson.GsonBuilder
import com.google.gson.JsonNull
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.IOException

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class WorkoutSyncCoordinatorTest {
    private lateinit var context: Context
    private val gson = GsonBuilder().serializeNulls().create()

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
    fun `offline changes replay in order after the store is reopened`() = runBlocking {
        val server = session()
        val localAfterFirst = patchSession(server, "set-1", 65.0, 9)
        val localAfterSecond = patchSession(localAfterFirst, "set-2", 45.0, 11)
        val first = setOperation("operation-1", "set-1", server, 65.0, 9, sequence = 0)
        val second = setOperation("operation-2", "set-2", localAfterFirst, 45.0, 11, sequence = 0)
        val store = WorkoutStore(context)
        store.enqueue(localAfterFirst.toSnapshot(), first)
        store.enqueue(localAfterSecond.toSnapshot(), second)
        val gateway = FakeWorkoutGateway(server, offline = true)

        val offline = WorkoutSyncCoordinator(context, store, gateway).syncPending()
        assertTrue(offline.pending)
        assertEquals(listOf("operation-1", "operation-2"), store.pendingOperations().map { it.id })
        store.close()

        val restarted = WorkoutStore(context)
        gateway.offline = false
        val result = WorkoutSyncCoordinator(context, restarted, gateway).syncPending()

        assertFalse(result.pending)
        assertTrue(restarted.pendingOperations().isEmpty())
        assertEquals(9, gateway.remote.exercises.single().sets[0].reps)
        assertEquals(11, gateway.remote.exercises.single().sets[1].reps)
        assertEquals(65.0, gateway.remote.exercises.single().sets[0].weightKg!!, 0.001)
        assertEquals(45.0, gateway.remote.exercises.single().sets[1].weightKg!!, 0.001)
        assertEquals(listOf("operation-1", "operation-1", "operation-2"), gateway.sentIds.take(3))
        assertNotEquals("operation-2", gateway.sentIds.last())
        restarted.close()
    }

    @Test
    fun `finish waits behind queued sets and syncs only after those sets are durable`() = runBlocking {
        val server = session()
        val localAfterSet = patchSession(server, "set-1", 65.0, 9)
        val afterFinish = localAfterSet.copy(active = false, finishedAt = "2026-09-25T10:10:00Z")
        val set = setOperation("set-before-finish", "set-1", server, 65.0, 9, sequence = 0)
        val finish = PendingOperation(
            sequence = 0,
            id = "finish-operation",
            type = "finish",
            sessionId = server.id,
            revision = server.revision,
            requestJson = """{"revision":4,"mutationId":"finish-operation","finishedAt":"2026-09-25T10:10:00Z"}""",
            baselineJson = gson.toJson(localAfterSet),
            createdAt = "2026-09-25T10:10:00Z",
            attempted = false
        )
        val store = WorkoutStore(context)
        store.enqueue(localAfterSet.toSnapshot(), set)
        store.enqueue(afterFinish.toSnapshot(pendingFinish = true), finish)
        val gateway = FakeWorkoutGateway(server)

        val result = WorkoutSyncCoordinator(context, store, gateway).syncPending()

        assertTrue(result.finished)
        assertTrue(store.pendingOperations().isEmpty())
        assertFalse(gateway.remote.active)
        assertEquals(listOf("set-before-finish", "finish-operation"), gateway.sentIds.take(2))
        assertNotEquals("finish-operation", gateway.sentIds.last())
        store.close()
    }

    private fun setOperation(id: String, setId: String, baseline: WorkoutSession, weightKg: Double, reps: Int, sequence: Long) = PendingOperation(
        sequence = sequence,
        id = id,
        type = "set",
        sessionId = baseline.id,
        setId = setId,
        revision = baseline.revision,
        requestJson = """{"revision":${baseline.revision},"mutationId":"$id","weightKg":$weightKg,"reps":$reps,"rpe":8,"rir":"2","done":true,"warmup":false,"resistanceMode":"external"}""",
        baselineJson = gson.toJson(baseline),
        createdAt = "2026-09-25T10:00:00Z",
        attempted = false
    )

    private fun session(): WorkoutSession = WorkoutSession(
        id = "workout-1",
        revision = 4,
        exercises = listOf(WorkoutExercise(
            id = "exercise-1",
            name = "Bench press",
            position = 0,
            prescription = listOf(SetPrescription(8, 10), SetPrescription(8, 10)),
            sets = listOf(
                WorkoutSet(id = "set-1", position = 0, weightKg = 60.0, reps = 8),
                WorkoutSet(id = "set-2", position = 1, weightKg = 40.0, reps = 10)
            )
        ))
    )

    private fun patchSession(session: WorkoutSession, setId: String, weightKg: Double, reps: Int): WorkoutSession = session.copy(
        exercises = session.exercises.map { exercise -> exercise.copy(sets = exercise.sets.map { set ->
            if (set.id == setId) set.copy(weightKg = weightKg, reps = reps, rpe = 8.0, rir = "2", done = true) else set
        }) },
        completedSets = session.completedSets + 1
    )

    private fun WorkoutSession.toSnapshot(pendingFinish: Boolean = false) = WorkoutSnapshot(
        session = this,
        unit = "kg",
        defaultRestSeconds = 90,
        activeExerciseId = "exercise-1",
        pendingFinish = pendingFinish
    )

    private class FakeWorkoutGateway(start: WorkoutSession, var offline: Boolean = false) : WorkoutGateway {
        var remote = start
            private set
        val sentIds = mutableListOf<String>()
        override suspend fun startPairing(): PairingStart = error("Unused in this test")
        override suspend fun pairingStatus(pairingId: String): PairingStatus = error("Unused in this test")
        override suspend fun active(): ActiveWorkoutResponse = ActiveWorkoutResponse(session = remote)
        override suspend fun workout(sessionId: String): WorkoutSession = remote
        override suspend fun revoke() = Unit

        override suspend fun send(operation: PendingOperation): WorkoutSession {
            sentIds.add(operation.id)
            if (offline) throw IOException("offline")
            if (operation.revision != remote.revision) throw ApiFailure(409, "stale revision")
            val request = JsonParser.parseString(operation.requestJson).asJsonObject
            remote = when (operation.type) {
                "set" -> applySet(operation, request)
                "finish" -> remote.copy(active = false, finishedAt = request.get("finishedAt").asString, revision = remote.revision + 1)
                "pause" -> remote.copy(pausedAt = request.get("occurredAt").asString, revision = remote.revision + 1)
                "resume" -> remote.copy(pausedAt = null, revision = remote.revision + 1)
                else -> error("Unexpected operation ${operation.type}")
            }
            return remote
        }

        private fun applySet(operation: PendingOperation, request: JsonObject): WorkoutSession {
            val target = operation.setId
            val exercises = remote.exercises.map { exercise -> exercise.copy(sets = exercise.sets.map { set ->
                if (set.id != target) set else set.copy(
                    weightKg = nullableDouble(request, "weightKg", set.weightKg),
                    reps = nullableInt(request, "reps", set.reps),
                    rpe = nullableDouble(request, "rpe", set.rpe),
                    rir = nullableString(request, "rir", set.rir),
                    done = request.get("done").asBoolean
                )
            }) }
            return remote.copy(exercises = exercises, revision = remote.revision + 1, completedSets = remote.completedSets + 1)
        }

        private fun nullableDouble(json: JsonObject, key: String, fallback: Double?): Double? =
            if (!json.has(key) || json.get(key).isJsonNull) fallback else json.get(key).asDouble

        private fun nullableInt(json: JsonObject, key: String, fallback: Int?): Int? =
            if (!json.has(key) || json.get(key).isJsonNull) fallback else json.get(key).asInt

        private fun nullableString(json: JsonObject, key: String, fallback: String?): String? =
            if (!json.has(key) || json.get(key) == JsonNull.INSTANCE) fallback else json.get(key).asString
    }
}
