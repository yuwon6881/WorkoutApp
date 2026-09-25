package com.workoutapp.wear.ui

import com.workoutapp.wear.data.RirPolicy
import com.workoutapp.wear.data.SetPrescription
import com.workoutapp.wear.data.WorkoutRepository
import com.workoutapp.wear.data.WorkoutSession
import java.time.Instant
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

fun formatPairingCode(code: String): String = if (code.length == 8) "${code.take(4)}-${code.drop(4)}" else code

fun formatLoad(value: Double): String = if (abs(value - value.roundToInt()) < 0.05) {
    value.roundToInt().toString()
} else {
    String.format(Locale.US, "%.1f", value)
}

fun kgToDisplay(kg: Double, unit: String): Double = if (unit == "lb") kg * WorkoutRepository.LB_PER_KG else kg

/** m:ss below an hour, h:mm:ss above it. */
fun formatClock(totalSeconds: Long): String {
    val seconds = totalSeconds.coerceAtLeast(0)
    val hours = seconds / 3_600
    val minutes = (seconds % 3_600) / 60
    val rest = (seconds % 60).toString().padStart(2, '0')
    return if (hours > 0) "$hours:${minutes.toString().padStart(2, '0')}:$rest" else "$minutes:$rest"
}

/** Rounds up so the display never reads 0:00 while the deadline is still ahead. */
fun remainingSeconds(deadlineEpochMs: Long, nowEpochMs: Long): Long =
    ((deadlineEpochMs - nowEpochMs).coerceAtLeast(0) + 999) / 1_000

fun restProgress(remainingMs: Long, baselineMs: Long): Float =
    if (baselineMs <= 0) 0f else (remainingMs.toFloat() / baselineMs).coerceIn(0f, 1f)

/** Active training time: paused spans are excluded, and a paused clock stays frozen at the pause. */
fun elapsedWorkoutSeconds(session: WorkoutSession, nowEpochMs: Long): Long? {
    val started = parseEpochMs(session.startedAt) ?: return null
    val end = session.pausedAt?.let(::parseEpochMs) ?: session.finishedAt?.let(::parseEpochMs) ?: nowEpochMs
    return ((end - started) / 1_000 - session.pausedSeconds).coerceAtLeast(0)
}

fun pairingSecondsLeft(expiresAt: String?, nowEpochMs: Long): Long? =
    expiresAt?.let(::parseEpochMs)?.let { ((it - nowEpochMs) / 1_000).coerceAtLeast(0) }

fun targetRepsText(prescription: SetPrescription?): String? = prescription?.let {
    it.repsText?.takeIf { text -> text.isNotBlank() } ?: when {
        it.repMin <= 0 -> null
        it.repMin == it.repMax || it.repMax <= 0 -> it.repMin.toString()
        else -> "${it.repMin}–${it.repMax}"
    }
}

fun stepReps(current: Int, increase: Boolean): Int = (current + if (increase) 1 else -1).coerceIn(MIN_REPS, MAX_REPS)

/**
 * Unknown load must stay unknown until the lifter sets one, so stepping up from unknown starts at a
 * real zero and stepping down past zero returns to "not recorded" rather than inventing a value.
 */
fun stepLoad(current: Double?, step: Double, increase: Boolean): Double? = when {
    current == null -> if (increase) 0.0 else null
    increase -> roundTenth(current + step)
    current <= 0.0 -> null
    else -> roundTenth((current - step).coerceAtLeast(0.0))
}

/** The first press on an unrated set accepts the prescribed RIR so a target can be confirmed in one tap. */
fun stepRir(current: String?, increase: Boolean, target: String?): String {
    val choices = RirPolicy.choices
    if (current == null || current !in choices) return target?.takeIf { it in choices } ?: DEFAULT_RIR
    val index = (choices.indexOf(current) + if (increase) 1 else -1).coerceIn(0, choices.lastIndex)
    return choices[index]
}

fun plural(count: Int, singular: String, pluralForm: String = "${singular}s"): String =
    "$count ${if (count == 1) singular else pluralForm}"

private fun roundTenth(value: Double): Double = (value * 10).roundToInt() / 10.0

private fun parseEpochMs(value: String): Long? = runCatching { Instant.parse(value).toEpochMilli() }.getOrNull()

const val MIN_REPS = 1
const val MAX_REPS = 100
private const val DEFAULT_RIR = "2"
