package com.workoutapp.wear.data

import java.time.Instant

/** Reads the server's shared rest into what the watch counts: a deadline, or a paused remainder. */
object RestSync {
    /** (deadline, generation, paused remainder) for a server rest at [nowMs]. */
    fun fromServer(rest: SessionRest?, nowMs: Long): Triple<Long?, String?, Long?> {
        if (rest == null) return Triple(null, null, null)
        return when (rest.status) {
            "running" -> {
                val deadline = rest.deadlineUtc?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
                // An ended rest is shown as over; its alert belonged to its own moment.
                if (deadline != null && deadline > nowMs) Triple(deadline, rest.generation, null) else Triple(null, null, null)
            }
            "paused" -> {
                val remaining = rest.pausedRemainingMs
                if (remaining != null && remaining > 0) Triple(null, rest.generation, remaining) else Triple(null, null, null)
            }
            else -> Triple(null, null, null)
        }
    }
}
