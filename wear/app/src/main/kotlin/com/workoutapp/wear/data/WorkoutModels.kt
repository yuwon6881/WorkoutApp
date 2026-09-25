package com.workoutapp.wear.data

data class ActiveWorkoutResponse(
    val unit: String = "kg",
    val restSeconds: Int = 90,
    val session: WorkoutSession? = null
)

data class WorkoutSession(
    val id: String = "",
    val name: String = "Workout",
    val active: Boolean = true,
    val startedAt: String = "",
    val finishedAt: String? = null,
    val pausedAt: String? = null,
    val pausedSeconds: Long = 0,
    val revision: Int = 0,
    val exercises: List<WorkoutExercise> = emptyList(),
    val completedSets: Int = 0,
    val warmupSets: Int = 0
)

data class WorkoutExercise(
    val id: String = "",
    val name: String = "",
    val position: Int = 0,
    val prescription: List<SetPrescription> = emptyList(),
    val sets: List<WorkoutSet> = emptyList(),
    val sequenceGroup: String = "",
    val loadModel: String = "external",
    val progression: Progression? = null,
    val restSeconds: Int? = null
)

data class SetPrescription(
    val repMin: Int = 0,
    val repMax: Int = 0,
    val repsText: String? = null,
    val rir: String? = null,
    val warmup: Boolean = false,
    val notes: String? = null
)

data class Progression(val stepKg: Double = 2.5)

data class SetSuggestion(
    val suggestedLoadKg: Double? = null,
    val suggestedReps: Int? = null
)

data class WorkoutSet(
    val id: String = "",
    val position: Int = 0,
    val weightKg: Double? = null,
    val reps: Int? = null,
    val rpe: Double? = null,
    val rir: String? = null,
    val done: Boolean = false,
    val warmup: Boolean = false,
    val resistanceMode: String = "external",
    val suggestion: SetSuggestion? = null
)

data class WorkoutSnapshot(
    val session: WorkoutSession,
    val unit: String,
    val defaultRestSeconds: Int,
    val activeExerciseId: String? = null,
    val restEndsAtEpochMs: Long? = null,
    val pausedRestRemainingMs: Long? = null,
    val restGeneration: String? = null,
    val alertedRestGeneration: String? = null,
    val conflictOperationId: String? = null,
    val conflictSession: WorkoutSession? = null,
    val pendingFinish: Boolean = false
)

data class PendingOperation(
    val sequence: Long,
    val id: String,
    val type: String,
    val sessionId: String,
    val setId: String? = null,
    val revision: Int,
    val requestJson: String,
    val baselineJson: String,
    val createdAt: String,
    val attempted: Boolean
)

data class SetPatch(
    val weightKg: Double?,
    val reps: Int?,
    val rpe: Double?,
    val rir: String?,
    val done: Boolean,
    val warmup: Boolean,
    val resistanceMode: String
)

data class PairingStart(
    val pairingId: String,
    val code: String,
    val expiresAt: String
)

data class PairingStatus(val status: String, val expiresAt: String)

data class ApiErrorBody(val message: String? = null)

data class WorkoutUiState(
    val loading: Boolean = false,
    val pairing: Boolean = false,
    val pairingCode: String? = null,
    val message: String? = null,
    val error: String? = null,
    val snapshot: WorkoutSnapshot? = null,
    val syncing: Boolean = false
)
