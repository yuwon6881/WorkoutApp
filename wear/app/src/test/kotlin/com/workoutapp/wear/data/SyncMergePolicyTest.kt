package com.workoutapp.wear.data

import com.google.gson.GsonBuilder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class SyncMergePolicyTest {
    private val gson = GsonBuilder().serializeNulls().create()

    @Test
    fun `a newer revision that changed another set can be rebased`() {
        val baseline = session()
        val remote = baseline.copy(
            revision = 5,
            exercises = listOf(baseline.exercises.single().copy(
                sets = listOf(baseline.exercises.single().sets[0], baseline.exercises.single().sets[1].copy(reps = 12))
            ))
        )

        val merged = SyncMergePolicy.rebaseSet(setOperation(baseline), remote)

        assertNotNull(merged)
        assertEquals(65.0, merged!!["weightKg"].asDouble, 0.001)
        assertEquals(9, merged["reps"].asInt)
    }

    @Test
    fun `any concurrent change to the same set is held for review`() {
        val baseline = session()
        val changedSet = baseline.exercises.single().sets[0].copy(reps = 11)
        val remote = baseline.copy(revision = 5, exercises = listOf(
            baseline.exercises.single().copy(sets = listOf(changedSet, baseline.exercises.single().sets[1]))
        ))

        assertNull(SyncMergePolicy.rebaseSet(setOperation(baseline), remote))
    }

    @Test
    fun `finish can follow the watch outbox but external session edits need review`() {
        val baseline = session()
        val operation = PendingOperation(
            sequence = 3,
            id = "finish-id",
            type = "finish",
            sessionId = baseline.id,
            revision = baseline.revision,
            requestJson = """{"revision":4,"mutationId":"finish-id","finishedAt":"2026-09-25T10:00:00Z"}""",
            baselineJson = gson.toJson(baseline),
            createdAt = "2026-09-25T10:00:00Z",
            attempted = true
        )

        assertNotNull(SyncMergePolicy.rebaseFinish(operation, baseline.copy(revision = 5)))
        val externalChange = baseline.copy(
            revision = 5,
            exercises = listOf(baseline.exercises.single().copy(
                sets = listOf(baseline.exercises.single().sets[0].copy(reps = 7), baseline.exercises.single().sets[1])
            ))
        )
        assertNull(SyncMergePolicy.rebaseFinish(operation, externalChange))
    }

    @Test
    fun `pause replay rebases only while server pause state still matches its baseline`() {
        val baseline = session()
        val operation = PendingOperation(
            sequence = 2,
            id = "pause-id",
            type = "pause",
            sessionId = baseline.id,
            revision = baseline.revision,
            requestJson = """{"revision":4,"mutationId":"pause-id","occurredAt":"2026-09-25T10:00:00Z"}""",
            baselineJson = gson.toJson(baseline),
            createdAt = "2026-09-25T10:00:00Z",
            attempted = true
        )

        assertNotNull(SyncMergePolicy.rebaseTiming(operation, baseline.copy(revision = 5)))
        assertNull(SyncMergePolicy.rebaseTiming(operation, baseline.copy(revision = 5, pausedAt = "2026-09-25T10:01:00Z")))
    }

    private fun setOperation(baseline: WorkoutSession) = PendingOperation(
        sequence = 1,
        id = "set-id",
        type = "set",
        sessionId = baseline.id,
        setId = "set-1",
        revision = baseline.revision,
        requestJson = """{"revision":4,"mutationId":"set-id","weightKg":65,"reps":9,"rpe":8,"rir":"2","done":true,"warmup":false,"resistanceMode":"external"}""",
        baselineJson = gson.toJson(baseline),
        createdAt = "2026-09-25T09:59:00Z",
        attempted = true
    )

    private fun session(): WorkoutSession {
        val exercise = WorkoutExercise(
            id = "exercise-1",
            name = "Bench press",
            position = 0,
            prescription = listOf(SetPrescription(8, 10), SetPrescription(8, 10)),
            sets = listOf(
                WorkoutSet(id = "set-1", position = 0, weightKg = 60.0, reps = 8),
                WorkoutSet(id = "set-2", position = 1, weightKg = 40.0, reps = 10)
            )
        )
        return WorkoutSession(id = "workout-1", revision = 4, exercises = listOf(exercise))
    }
}
