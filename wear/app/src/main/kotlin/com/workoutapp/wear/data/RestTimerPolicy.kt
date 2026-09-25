package com.workoutapp.wear.data

object RestTimerPolicy {
    fun remainingMs(deadlineEpochMs: Long, nowEpochMs: Long): Long = (deadlineEpochMs - nowEpochMs).coerceAtLeast(0L)

    fun resumeDeadline(remainingMs: Long?, nowEpochMs: Long): Long? =
        remainingMs?.takeIf { it > 0 }?.let { nowEpochMs + it }

    fun isExpired(deadlineEpochMs: Long, nowEpochMs: Long): Boolean = deadlineEpochMs <= nowEpochMs
}
