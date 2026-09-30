package com.workoutapp.wear.ui

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import com.workoutapp.wear.data.SetPrescription
import com.workoutapp.wear.data.WorkoutRepository

/**
 * One crown detent on a timed set is five seconds. Unknown time stays unknown until the lifter sets
 * one, and stepping below the first step returns to "not recorded" rather than logging zero.
 */
fun stepSeconds(current: Int?, increase: Boolean): Int? = when {
    current == null -> if (increase) SECONDS_STEP else null
    increase -> (current + SECONDS_STEP).coerceAtMost(WorkoutRepository.MAX_SET_SECONDS)
    current <= SECONDS_STEP -> null
    else -> current - SECONDS_STEP
}

/** Whole seconds a running timer has reached from where the set left off, capped at its target or what can be saved. */
fun stopwatchSeconds(baseSeconds: Int, startedAtEpochMs: Long, nowEpochMs: Long, targetSeconds: Int? = null): Int {
    val elapsed = ((nowEpochMs - startedAtEpochMs) / 1_000).coerceAtLeast(0)
    val cap = (targetSeconds ?: WorkoutRepository.MAX_SET_SECONDS).toLong()
    return (baseSeconds + elapsed).coerceAtMost(cap).toInt()
}

/** Printed target text verbatim; otherwise the plan's number, which on a timed exercise means seconds. */
fun timedTargetText(prescription: SetPrescription?): String? =
    prescription?.repsText?.takeIf { it.isNotBlank() } ?: targetRepsText(prescription)?.let { "$it s" }

// Mirrors the web's DURATION_TEXT: the printed shapes the import keeps as a duration, plus a bare
// number or range, which on a timed exercise means seconds. A bare "m" is metres, never minutes.
private val DURATION_TEXT = Regex(
    "^(?:[~≈]\\s*)?(?:(\\d{1,2})?:(\\d{2})|(\\d+(?:\\.\\d+)?)(?:\\s*(?:[-–]|to)\\s*(\\d+(?:\\.\\d+)?))?\\s*[- ]?\\s*" +
        "(s|secs?|seconds?|mins?|minutes?)?)(?:\\s+(?:hold|each(?:\\s+side)?|per\\s+(?:leg|side)))?$",
    RegexOption.IGNORE_CASE
)

/** Seconds the set's countdown runs to (the top of a range), or null to count up until stopped. */
fun timedTargetSeconds(prescription: SetPrescription?): Int? {
    prescription ?: return null
    val text = prescription.repsText?.trim().orEmpty()
    val seconds: Double = if (text.isEmpty()) {
        (prescription.repMax.takeIf { it > 0 } ?: prescription.repMin.takeIf { it > 0 } ?: return null).toDouble()
    } else {
        val match = DURATION_TEXT.matchEntire(text) ?: return null
        val (clockMinutes, clockSeconds, low, high, unit) = match.destructured
        if (clockSeconds.isNotEmpty()) (clockMinutes.toIntOrNull() ?: 0) * 60.0 + clockSeconds.toInt()
        else (high.ifEmpty { low }).toDouble() * if (unit.startsWith("min", ignoreCase = true)) 60 else 1
    }
    val whole = Math.round(seconds).toInt()
    return whole.takeIf { it in 1..WorkoutRepository.MAX_SET_SECONDS }
}

fun formatSetSeconds(seconds: Int?): String = seconds?.let { formatClock(it.toLong()) } ?: "—"

/** The same short double pulse as the end of a rest, for a timed set reaching its target. */
fun vibrateTimerDone(context: Context) {
    val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        context.getSystemService(VibratorManager::class.java)?.defaultVibrator
    } else {
        @Suppress("DEPRECATION")
        context.getSystemService(Vibrator::class.java)
    }
    if (vibrator?.hasVibrator() == true) {
        vibrator.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 180, 100, 180), -1))
    }
}

const val SECONDS_STEP = 5
