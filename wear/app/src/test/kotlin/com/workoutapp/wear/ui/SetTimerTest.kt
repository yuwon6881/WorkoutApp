package com.workoutapp.wear.ui

import com.workoutapp.wear.data.RestPolicy
import com.workoutapp.wear.data.SetPrescription
import com.workoutapp.wear.data.WorkoutExercise
import com.workoutapp.wear.data.WorkoutRepository
import com.workoutapp.wear.data.WorkoutSet
import com.workoutapp.wear.ui.FakeWorkouts.snapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SetTimerTest {
    @Test
    fun crownStepsFiveSecondsAndNeverLogsZero() {
        assertEquals(5, stepSeconds(null, increase = true))
        assertNull(stepSeconds(null, increase = false))
        assertEquals(35, stepSeconds(30, increase = true))
        assertNull(stepSeconds(5, increase = false))
        assertEquals(WorkoutRepository.MAX_SET_SECONDS, stepSeconds(WorkoutRepository.MAX_SET_SECONDS, increase = true))
    }

    @Test
    fun stopwatchContinuesFromTheEnteredTimeAndStopsOnce() {
        val draft = SetDraft(reps = 1, load = null, rir = null, seconds = 20)
        draft.startTimer(1_000)
        assertTrue(draft.timing)
        assertEquals(30, draft.secondsAt(11_900))
        assertEquals(35, draft.stopTimer(16_000))
        assertFalse(draft.timing)
        assertEquals(35, draft.secondsAt(99_000))
    }

    @Test
    fun aStopwatchStoppedAtOnceRecordsNoTime() {
        val draft = SetDraft(reps = 1, load = null, rir = null)
        draft.startTimer(1_000)
        assertNull(draft.stopTimer(1_500))
    }

    @Test
    fun timedExerciseShowsItsTargetAsTimeAndStartsWithoutATime() {
        val plank = WorkoutExercise(
            id = "plank", name = "Plank", trackingMode = "duration",
            prescription = listOf(SetPrescription(repMin = 30, repMax = 45)),
            sets = listOf(WorkoutSet(id = "plank-1"))
        )
        val base = snapshot()
        val model = activeSetModel(base.copy(session = base.session.copy(exercises = listOf(plank)), activeExerciseId = "plank"))
        assertTrue(model.timed)
        assertEquals("30–45 s", model.targetReps)
        assertNull(model.startingSeconds)
        assertEquals("45 sec", timedTargetText(SetPrescription(repsText = "45 sec")))
    }

    @Test
    fun countdownTargetMatchesTheWebReadingOfPrintedAndTypedTimes() {
        assertEquals(45, timedTargetSeconds(SetPrescription(repsText = "45 sec")))
        assertEquals(45, timedTargetSeconds(SetPrescription(repsText = "45s hold")))
        assertEquals(45, timedTargetSeconds(SetPrescription(repsText = "0:45")))
        assertEquals(90, timedTargetSeconds(SetPrescription(repsText = "1:30")))
        assertEquals(60, timedTargetSeconds(SetPrescription(repsText = "1 min")))
        assertEquals(45, timedTargetSeconds(SetPrescription(repsText = "30–45 sec each side")))
        assertEquals(60, timedTargetSeconds(SetPrescription(repsText = "~60 seconds")))
        assertEquals(45, timedTargetSeconds(SetPrescription(repMin = 45, repMax = 45)))
        assertEquals(60, timedTargetSeconds(SetPrescription(repMin = 30, repMax = 60)))
        assertNull(timedTargetSeconds(SetPrescription()))
        assertNull(timedTargetSeconds(null))
        assertNull(timedTargetSeconds(SetPrescription(repsText = "AMRAP")))
        assertNull(timedTargetSeconds(SetPrescription(repsText = "20 m")))
    }

    @Test
    fun aCountdownCapsAtItsTargetAndFinishesWithTheTargetRecorded() {
        val draft = SetDraft(reps = 1, load = null, rir = null)
        draft.startTimer(0, targetSeconds = 45)
        assertEquals(15, draft.remainingAt(30_000))
        assertEquals(45_000L, draft.countdownEndsAt())
        assertEquals(45, draft.secondsAt(99_000))
        draft.finishCountdown()
        assertFalse(draft.timing)
        assertEquals(45, draft.seconds)
        // A set already at its target starts a fresh attempt rather than finishing at once.
        draft.startTimer(100_000, targetSeconds = 45)
        assertEquals(145_000L, draft.countdownEndsAt())
    }

    @Test
    fun withoutATargetTheTimerCountsUpUntilStopped() {
        val draft = SetDraft(reps = 1, load = null, rir = null)
        draft.startTimer(0, targetSeconds = null)
        assertNull(draft.remainingAt(600_000))
        assertNull(draft.countdownEndsAt())
        assertEquals(600, draft.stopTimer(600_000))
    }

    @Test
    fun shorteningPastTheDeadlineEndsTheRest() {
        assertEquals(40_000L, RestPolicy.shortenedDeadline(55_000, 15, 10_000))
        assertNull(RestPolicy.shortenedDeadline(20_000, 15, 10_000))
    }
}
