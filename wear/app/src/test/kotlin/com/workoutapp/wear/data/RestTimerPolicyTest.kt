package com.workoutapp.wear.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Test

class RestTimerPolicyTest {
    @Test
    fun `rest deadline keeps counting while the screen is off`() {
        val deadline = 2_000_000L
        assertEquals(30_000L, RestTimerPolicy.remainingMs(deadline, 1_970_000L))
        assertEquals(0L, RestTimerPolicy.remainingMs(deadline, deadline + 10_000L))
        assertTrue(RestTimerPolicy.isExpired(deadline, deadline))
        assertFalse(RestTimerPolicy.isExpired(deadline, deadline - 1L))
    }

    @Test
    fun `pause preserves remaining rest and resume creates a new deadline`() {
        val remaining = RestTimerPolicy.remainingMs(2_000_000L, 1_980_000L)
        assertEquals(20_000L, remaining)
        assertEquals(5_020_000L, RestTimerPolicy.resumeDeadline(remaining, 5_000_000L))
        assertNull(RestTimerPolicy.resumeDeadline(0L, 5_000_000L))
        assertNull(RestTimerPolicy.resumeDeadline(null, 5_000_000L))
    }

    @Test
    fun `replacement updates the active rest deadline`() {
        val initialDeadline = 2_000_000L
        val now = 1_950_000L
        assertEquals(50_000L, RestTimerPolicy.remainingMs(initialDeadline, now))
        val replacedDeadline = initialDeadline + 30_000L
        assertEquals(80_000L, RestTimerPolicy.remainingMs(replacedDeadline, now))
        assertFalse(RestTimerPolicy.isExpired(replacedDeadline, now))
    }

    @Test
    fun `cancellation clears or zeroes active rest`() {
        assertEquals(0L, RestTimerPolicy.remainingMs(1_000_000L, 1_000_000L))
        assertNull(RestTimerPolicy.resumeDeadline(0L, 2_000_000L))
        assertNull(RestTimerPolicy.resumeDeadline(null, 2_000_000L))
    }

    @Test
    fun `finish clears active rest`() {
        val deadline = 2_000_000L
        val finishTime = 2_010_000L
        assertTrue(RestTimerPolicy.isExpired(deadline, finishTime))
        assertEquals(0L, RestTimerPolicy.remainingMs(deadline, finishTime))
    }
}
