package com.workoutapp.wear.data

import java.time.Instant

/**
 * The time to stamp on a pause, resume or finish. The server refuses one before the workout started
 * or a resume before its pause, so a watch clock running a little behind the phone's is clamped to
 * the latest of those instead of sending an edit that would only come back for review.
 */
fun workoutEventInstant(now: Instant, session: WorkoutSession): Instant =
    listOfNotNull(now, parseInstant(session.startedAt), parseInstant(session.pausedAt)).max()

private fun parseInstant(value: String?): Instant? =
    value?.takeIf { it.isNotBlank() }?.let { runCatching { Instant.parse(it) }.getOrNull() }
