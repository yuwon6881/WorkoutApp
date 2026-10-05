package com.workoutapp.wear.data

import org.junit.Assert.assertEquals
import org.junit.Test

class SetTimerSnapshotTest {
    @Test
    fun `pause survives persistence and resume shifts the start by the pause duration`() {
        val running = SetTimerSnapshot(startedAt = 1000, targetSeconds = 30)
        val paused = running.pause(11000)
        assertEquals(11000L, paused.pausedAt)
        assertEquals(paused, paused.pause(90000))
        val resumed = paused.resume(101000)
        assertEquals(91000L, resumed.startedAt)
        assertEquals(null, resumed.pausedAt)
    }
}
