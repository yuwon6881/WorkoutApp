package com.workoutapp.wear.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RirPolicyTest {
    @Test
    fun `zero through four RIR map to the matching RPE complement`() {
        assertEquals(10.0, RirPolicy.toRpe("0"))
        assertEquals(9.0, RirPolicy.toRpe("1"))
        assertEquals(8.0, RirPolicy.toRpe("2"))
        assertEquals(7.0, RirPolicy.toRpe("3"))
        assertEquals(6.0, RirPolicy.toRpe("4"))
    }

    @Test
    fun `five plus has no precise RPE and warmups never retain an RIR`() {
        assertNull(RirPolicy.toRpe("5+"))
        assertNull(RirPolicy.normalize("5+", warmup = true))
        assertNull(RirPolicy.normalize("2", warmup = true))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `unknown RIR choices are rejected`() {
        RirPolicy.normalize("6", warmup = false)
    }
}
