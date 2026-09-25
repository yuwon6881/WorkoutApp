package com.workoutapp.wear.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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
}
