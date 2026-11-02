package com.workoutapp.wear.data

/** Durable wall-clock timer state, scoped to a set in the current workout. */
data class SetTimerSnapshot(
    val startedAt: Long? = null,
    val baseSeconds: Int = 0,
    val targetSeconds: Int? = null,
    val stoppedSeconds: Int? = null,
    val pausedAt: Long? = null
) {
    fun pause(now: Long): SetTimerSnapshot =
        if (startedAt != null && pausedAt == null) copy(pausedAt = now) else this

    fun resume(now: Long): SetTimerSnapshot =
        if (startedAt != null && pausedAt != null) copy(startedAt = startedAt + (now - pausedAt).coerceAtLeast(0), pausedAt = null) else this

    /** When a running countdown reaches its target; null while paused, stopped or counting up. */
    fun countdownEndsAt(): Long? =
        if (pausedAt != null) null else startedAt?.let { started -> targetSeconds?.let { started + (it - baseSeconds) * 1_000L } }

    /** A countdown that reached its target: stopped, with the target recorded. */
    fun finished(): SetTimerSnapshot = copy(startedAt = null, stoppedSeconds = targetSeconds, pausedAt = null)
}
