package com.workoutapp.wear.ui

import com.workoutapp.wear.data.PendingOperation
import com.workoutapp.wear.data.Progression
import com.workoutapp.wear.data.SetPrescription
import com.workoutapp.wear.data.SetSuggestion
import com.workoutapp.wear.data.SetTimerSnapshot
import com.workoutapp.wear.data.WorkoutExercise
import com.workoutapp.wear.data.WorkoutSession
import com.workoutapp.wear.data.WorkoutSet
import com.workoutapp.wear.data.WorkoutSnapshot
import java.time.Instant

/** Deterministic sample workouts for rendering and model tests. */
object FakeWorkouts {
    val now: Long = Instant.parse("2026-09-25T10:32:15Z").toEpochMilli()
    private const val STARTED = "2026-09-25T10:00:00Z"

    private fun sets(count: Int, done: Int, weightKg: Double?, reps: Int?, suggestion: Double? = null, warmups: Int = 0, mode: String = "external") =
        (0 until count).map { index ->
            WorkoutSet(
                id = "set-$index-${weightKg ?: "none"}-$mode",
                position = index,
                weightKg = if (index < done) weightKg else null,
                reps = if (index < done) reps else null,
                rir = if (index < done && index >= warmups) "2" else null,
                done = index < done,
                warmup = index < warmups,
                resistanceMode = mode,
                suggestion = suggestion?.let { SetSuggestion(suggestedLoadKg = it, suggestedReps = reps) }
            )
        }

    private fun prescription(count: Int, min: Int, max: Int, rir: String?, warmups: Int = 0) =
        (0 until count).map { SetPrescription(repMin = min, repMax = max, rir = if (it < warmups) null else rir, warmup = it < warmups) }

    val bench = WorkoutExercise(
        id = "bench", name = "Barbell Bench Press", position = 0,
        prescription = prescription(5, 6, 8, "2", warmups = 1),
        sets = sets(5, 2, 80.0, 8, suggestion = 82.5, warmups = 1),
        progression = Progression(2.5), restSeconds = 150
    )
    val incline = WorkoutExercise(
        id = "incline", name = "Incline Dumbbell Press", position = 1,
        prescription = prescription(3, 8, 10, "1"),
        sets = sets(3, 0, null, null, suggestion = 30.0)
    )
    val lateral = WorkoutExercise(
        id = "lateral", name = "Single-Arm Cable Lateral Raise Behind Back", position = 2,
        prescription = prescription(3, 12, 15, "1"),
        sets = sets(3, 0, null, null)
    )
    val dips = WorkoutExercise(
        id = "dips", name = "Bodyweight Dips", position = 3, loadModel = "full_bodyweight",
        prescription = prescription(3, 10, 12, "2"),
        sets = sets(3, 0, null, null, mode = "bodyweight")
    )
    val plank = WorkoutExercise(
        id = "plank", name = "Plank Hold", position = 4, trackingMode = "duration",
        prescription = listOf(SetPrescription(repMin = 45, repMax = 45, repsText = "45 sec")),
        sets = listOf(WorkoutSet(id = "plank-0", position = 0, done = false, durationSeconds = null))
    )
    val longNameExercise = WorkoutExercise(
        id = "long-name", name = "Standing Dual Cable Incline Chest Fly With Supinated Grip", position = 5,
        prescription = prescription(3, 10, 12, "2"),
        sets = sets(3, 0, null, null, suggestion = 15.0)
    )
    val weightedPullups = WorkoutExercise(
        id = "pullups", name = "Weighted Pull-Up", position = 6, loadModel = "full_bodyweight",
        prescription = prescription(3, 6, 8, "2"),
        sets = listOf(WorkoutSet(id = "pullup-0", position = 0, weightKg = 15.0, reps = 6, done = false, resistanceMode = "added"))
    )
    val assistedDips = WorkoutExercise(
        id = "assisted-dips", name = "Assisted Dips", position = 7, loadModel = "full_bodyweight",
        prescription = prescription(3, 8, 10, "2"),
        sets = listOf(WorkoutSet(id = "adips-0", position = 0, weightKg = 20.0, reps = 8, done = false, resistanceMode = "assistance"))
    )
    val deadHang = WorkoutExercise(
        id = "hang", name = "Dead Hang", position = 8, trackingMode = "duration",
        prescription = listOf(SetPrescription()),
        sets = listOf(WorkoutSet(id = "hang-0", position = 0, done = false, durationSeconds = null))
    )

    val session = WorkoutSession(
        id = "session-1", name = "Push Day A — Strength", startedAt = STARTED, revision = 7,
        exercises = listOf(bench, incline, lateral, dips),
        completedSets = 1, warmupSets = 1
    )

    fun snapshot(
        activeExerciseId: String? = "bench",
        session: WorkoutSession = this.session,
        unit: String = "kg",
        restEndsAtEpochMs: Long? = null,
        alertedRestGeneration: String? = null,
        pausedRestRemainingMs: Long? = null,
        pendingFinish: Boolean = false,
        conflictOperationId: String? = null,
        conflictSession: WorkoutSession? = null,
        trackRir: Boolean = true,
        setTimers: Map<String, SetTimerSnapshot>? = emptyMap()
    ): WorkoutSnapshot {
        val extra = when (activeExerciseId) {
            "plank" -> plank
            "hang" -> deadHang
            "long-name" -> longNameExercise
            "pullups" -> weightedPullups
            "assisted-dips" -> assistedDips
            else -> null
        }
        val resolvedSession = if (extra != null && session.exercises.none { it.id == extra.id }) {
            session.copy(exercises = session.exercises + extra)
        } else {
            session
        }
        return WorkoutSnapshot(
            session = resolvedSession, unit = unit, defaultRestSeconds = 90, activeExerciseId = activeExerciseId,
            restEndsAtEpochMs = restEndsAtEpochMs, restGeneration = restEndsAtEpochMs?.let { "rest-1" },
            alertedRestGeneration = alertedRestGeneration, pausedRestRemainingMs = pausedRestRemainingMs,
            pendingFinish = pendingFinish, conflictOperationId = conflictOperationId, conflictSession = conflictSession,
            trackRir = trackRir,
            setTimers = setTimers
        )
    }

    val paused = session.copy(pausedAt = "2026-09-25T10:30:00Z", pausedSeconds = 60)

    val warmupFirst = session.copy(exercises = listOf(bench.copy(sets = sets(5, 0, null, null, suggestion = 40.0, warmups = 1))) + session.exercises.drop(1))

    val allDone = session.copy(exercises = session.exercises.map { exercise -> exercise.copy(sets = exercise.sets.map { it.copy(done = true, reps = 10, weightKg = it.weightKg ?: 20.0) }) })

    val nothingLogged = session.copy(completedSets = 0, warmupSets = 0,
        exercises = session.exercises.map { exercise -> exercise.copy(sets = exercise.sets.map { it.copy(done = false) }) })

    fun operation(type: String, setId: String? = null) = PendingOperation(
        sequence = 1, id = "op-1", type = type, sessionId = session.id, setId = setId, revision = 7,
        requestJson = "{}", baselineJson = "{}", createdAt = STARTED, attempted = true
    )

    fun conflictingSetSession(): WorkoutSession {
        val setId = bench.sets[1].id
        return session.copy(revision = 9, exercises = session.exercises.map { exercise ->
            if (exercise.id != "bench") exercise else exercise.copy(sets = exercise.sets.map {
                if (it.id == setId) it.copy(weightKg = 77.5, reps = 9, rir = "3") else it
            })
        })
    }
}
