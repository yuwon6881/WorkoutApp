package com.workoutapp.wear.ui

import com.workoutapp.wear.data.SetPrescription
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WorkoutFormatTest {
    @Test
    fun clockUsesMinutesBelowAnHourAndHoursAbove() {
        assertEquals("0:00", formatClock(0))
        assertEquals("1:28", formatClock(88))
        assertEquals("59:59", formatClock(3_599))
        assertEquals("1:02:05", formatClock(3_725))
        assertEquals("0:00", formatClock(-5))
    }

    @Test
    fun remainingRestRoundsUpSoTheDisplayNeverShowsZeroEarly() {
        assertEquals(1, remainingSeconds(deadlineEpochMs = 10_001, nowEpochMs = 10_000))
        assertEquals(0, remainingSeconds(deadlineEpochMs = 10_000, nowEpochMs = 10_000))
        assertEquals(0, remainingSeconds(deadlineEpochMs = 9_000, nowEpochMs = 10_000))
    }

    @Test
    fun restProgressIsClampedToTheRing() {
        assertEquals(0.5f, restProgress(45_000, 90_000), 0.0001f)
        assertEquals(1f, restProgress(120_000, 90_000), 0.0001f)
        assertEquals(0f, restProgress(10, 0), 0.0001f)
    }

    @Test
    fun elapsedExcludesPausesAndFreezesWhilePaused() {
        val start = FakeWorkouts.session.copy(startedAt = "2026-09-25T10:00:00Z", pausedSeconds = 60)
        assertEquals(1_875L, elapsedWorkoutSeconds(start, FakeWorkouts.now))
        val paused = start.copy(pausedAt = "2026-09-25T10:30:00Z")
        assertEquals(1_740L, elapsedWorkoutSeconds(paused, FakeWorkouts.now + 600_000))
        assertNull(elapsedWorkoutSeconds(start.copy(startedAt = "not a time"), FakeWorkouts.now))
    }

    @Test
    fun loadFormattingDropsTrailingZeroOnly() {
        assertEquals("80", formatLoad(80.0))
        assertEquals("82.5", formatLoad(82.5))
        assertEquals("181.9", formatLoad(181.88))
    }

    @Test
    fun unknownLoadStaysUnknownUntilTheLifterSetsOne() {
        assertNull(stepLoad(null, 2.5, increase = false))
        assertEquals(0.0, stepLoad(null, 2.5, increase = true)!!, 0.0)
        assertEquals(2.5, stepLoad(0.0, 2.5, increase = true)!!, 0.0)
        assertEquals(0.0, stepLoad(1.0, 2.5, increase = false)!!, 0.0)
        assertNull(stepLoad(0.0, 2.5, increase = false))
        assertEquals(66.1, stepLoad(60.6, 5.51, increase = true)!!, 0.0)
    }

    @Test
    fun repsStayWithinTheLoggableRange() {
        assertEquals(MIN_REPS, stepReps(MIN_REPS, increase = false))
        assertEquals(9, stepReps(8, increase = true))
        assertEquals(MAX_REPS, stepReps(MAX_REPS, increase = true))
    }

    @Test
    fun firstRirPressAcceptsTheTargetThenStepsThroughChoices() {
        assertEquals("1", stepRir(null, increase = true, target = "1"))
        assertEquals("2", stepRir(null, increase = false, target = "1-2"))
        assertEquals("3", stepRir("2", increase = true, target = null))
        assertEquals("5+", stepRir("4", increase = true, target = null))
        assertEquals("5+", stepRir("5+", increase = true, target = null))
        assertEquals("0", stepRir("0", increase = false, target = null))
    }

    @Test
    fun targetRepsPrefersPrintedTextThenRange() {
        assertEquals("AMRAP", targetRepsText(SetPrescription(repMin = 5, repMax = 8, repsText = "AMRAP")))
        assertEquals("6–8", targetRepsText(SetPrescription(repMin = 6, repMax = 8)))
        assertEquals("5", targetRepsText(SetPrescription(repMin = 5, repMax = 5)))
        assertNull(targetRepsText(SetPrescription()))
        assertNull(targetRepsText(null))
    }

    @Test
    fun pairingHelpers() {
        assertEquals("K7QM-2XRP", formatPairingCode("K7QM2XRP"))
        assertEquals("ABC", formatPairingCode("ABC"))
        assertEquals(272L, pairingSecondsLeft("2026-09-25T10:36:47Z", FakeWorkouts.now))
        assertEquals(0L, pairingSecondsLeft("2026-09-25T10:00:00Z", FakeWorkouts.now))
        assertNull(pairingSecondsLeft(null, FakeWorkouts.now))
    }
}
