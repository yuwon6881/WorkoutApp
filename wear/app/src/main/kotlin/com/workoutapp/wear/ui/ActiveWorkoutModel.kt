package com.workoutapp.wear.ui

import com.workoutapp.wear.data.RirPolicy
import com.workoutapp.wear.data.WorkoutExercise
import com.workoutapp.wear.data.WorkoutSession
import com.workoutapp.wear.data.WorkoutSet
import com.workoutapp.wear.data.WorkoutSnapshot

/** Everything the set page needs, derived once from the persisted snapshot. */
data class ActiveSetModel(
    val exercise: WorkoutExercise,
    val set: WorkoutSet?,
    val setNumber: Int,
    val setCount: Int,
    val warmup: Boolean,
    val targetReps: String?,
    val targetRir: String?,
    val startingReps: Int,
    /** Display-unit load the editor starts from; null means no load is known yet. */
    val startingLoad: Double?,
    val suggestedLoad: Double?,
    val loadStep: Double,
    /** Bodyweight and reps-only sets carry their stored load through untouched instead of offering an editor. */
    val loadEditable: Boolean,
    val resistanceMode: String,
    val loadLabel: String,
    val startingRir: String?
)

data class NextUp(val exerciseName: String, val detail: String)

data class WorkoutProgress(val doneSets: Int, val plannedSets: Int) {
    val fraction: Float get() = if (plannedSets <= 0) 0f else (doneSets.toFloat() / plannedSets).coerceIn(0f, 1f)
}

fun activeExercise(snapshot: WorkoutSnapshot): WorkoutExercise {
    val exercises = snapshot.session.exercises
    return exercises.firstOrNull { it.id == snapshot.activeExerciseId }
        ?: exercises.firstOrNull { row -> row.sets.any { !it.done } }
        ?: exercises.firstOrNull()
        ?: WorkoutExercise(name = "No exercises")
}

fun activeSetModel(snapshot: WorkoutSnapshot): ActiveSetModel {
    val exercise = activeExercise(snapshot)
    val set = exercise.sets.firstOrNull { !it.done }
    val prescription = set?.let { exercise.prescription.getOrNull(it.position) }
    val unit = snapshot.unit
    val stepKg = exercise.progression?.stepKg?.takeIf { it > 0 } ?: DEFAULT_STEP_KG
    val mode = set?.resistanceMode ?: "external"
    val loadEditable = mode in EDITABLE_LOAD_MODES
    return ActiveSetModel(
        exercise = exercise,
        set = set,
        setNumber = (set?.position ?: exercise.sets.size - 1) + 1,
        setCount = exercise.sets.size,
        warmup = set?.warmup == true,
        targetReps = targetRepsText(prescription),
        targetRir = prescription?.rir?.takeIf { it.isNotBlank() },
        startingReps = (set?.reps ?: prescription?.repMin?.takeIf { it > 0 } ?: MIN_REPS)
            .coerceIn(MIN_REPS, MAX_REPS),
        startingLoad = (set?.weightKg ?: set?.suggestion?.suggestedLoadKg)?.let { roundedDisplay(it, unit) },
        suggestedLoad = set?.suggestion?.suggestedLoadKg?.takeIf { set.weightKg == null }?.let { roundedDisplay(it, unit) },
        loadStep = kgToDisplay(stepKg, unit),
        loadEditable = loadEditable,
        resistanceMode = mode,
        loadLabel = when (mode) {
            "added" -> "Added load"
            "assistance" -> "Assistance"
            "bodyweight" -> "Bodyweight"
            "reps_only" -> "Reps only"
            else -> "Load"
        },
        startingRir = set?.rir?.takeIf { it in RirPolicy.choices }
    )
}

/** Load to submit for a set whose load is not edited on the watch: the stored value, in display units. */
fun passthroughLoad(set: WorkoutSet?, unit: String): Double? = set?.weightKg?.let { kgToDisplay(it, unit) }

/** What the set page will show once rest ends, so the rest screen can preview it. */
fun nextUp(snapshot: WorkoutSnapshot): NextUp? {
    val model = activeSetModel(snapshot)
    val set = model.set ?: return null
    val detail = if (set.warmup) "Next · warm-up" else "Next · set ${model.setNumber} of ${model.setCount}"
    return NextUp(model.exercise.name, detail)
}

fun workoutProgress(session: WorkoutSession): WorkoutProgress {
    val working = session.exercises.flatMap { it.sets }.filterNot { it.warmup }
    return WorkoutProgress(doneSets = working.count { it.done }, plannedSets = working.size)
}

fun allSetsLogged(session: WorkoutSession): Boolean = session.exercises.none { row -> row.sets.any { !it.done } }

fun nextIncompleteExercise(session: WorkoutSession, afterId: String): WorkoutExercise? {
    val start = session.exercises.indexOfFirst { it.id == afterId }
    val ordered = session.exercises.drop(start + 1) + session.exercises.take(start + 1)
    return ordered.firstOrNull { row -> row.sets.any { !it.done } }
}

private fun roundedDisplay(kg: Double, unit: String): Double = Math.round(kgToDisplay(kg, unit) * 10) / 10.0

private const val DEFAULT_STEP_KG = 2.5
private val EDITABLE_LOAD_MODES = setOf("external", "added", "assistance")

/** The set the lifter can take back from the overview: the last one this watch logged, while it is still logged. */
data class UndoableSet(val exerciseName: String, val summary: String)

fun undoableSet(snapshot: WorkoutSnapshot): UndoableSet? {
    val setId = snapshot.lastLoggedSetId ?: return null
    if (!snapshot.session.active || snapshot.pendingFinish) return null
    val exercise = snapshot.session.exercises.firstOrNull { row -> row.sets.any { it.id == setId } } ?: return null
    val set = exercise.sets.first { it.id == setId }
    if (!set.done) return null
    val load = set.weightKg?.let { "${formatLoad(kgToDisplay(it, snapshot.unit))} ${snapshot.unit}" }
    val summary = listOfNotNull(set.reps?.let { plural(it, "rep") }, load).joinToString(" · ").ifEmpty { "Logged set" }
    return UndoableSet(exercise.name, summary)
}
