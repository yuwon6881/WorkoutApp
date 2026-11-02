package com.workoutapp.wear.data

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Test

class WorkoutClockTest {
    private val started = "2026-09-25T10:00:00Z"

    @Test
    fun `a watch clock behind the workout start stamps the start instead`() {
        val session = WorkoutSession(startedAt = started)
        assertEquals(Instant.parse(started), workoutEventInstant(Instant.parse("2026-09-25T09:59:55Z"), session))
    }

    @Test
    fun `a resume never precedes its pause`() {
        val session = WorkoutSession(startedAt = started, pausedAt = "2026-09-25T10:20:00Z")
        assertEquals(Instant.parse("2026-09-25T10:20:00Z"), workoutEventInstant(Instant.parse("2026-09-25T10:19:58Z"), session))
    }

    @Test
    fun `an ordinary clock keeps its own time and unreadable stamps are ignored`() {
        val now = Instant.parse("2026-09-25T10:30:00Z")
        assertEquals(now, workoutEventInstant(now, WorkoutSession(startedAt = started)))
        assertEquals(now, workoutEventInstant(now, WorkoutSession(startedAt = "", pausedAt = "not a time")))
    }
}
