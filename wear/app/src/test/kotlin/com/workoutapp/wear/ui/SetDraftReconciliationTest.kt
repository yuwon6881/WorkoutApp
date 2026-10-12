package com.workoutapp.wear.ui

import com.workoutapp.wear.data.WorkoutSet
import com.workoutapp.wear.ui.FakeWorkouts.snapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SetDraftReconciliationTest {
    @Test
    fun untouchedPoundLoadKeepsFullCanonicalPrecision() {
        val model = activeSetModel(snapshot(unit = "lb"))
        val draft = SetDraft(model.startingReps, model.startingLoad, model.startingRir)
        val canonical = model.set!!.weightKg ?: model.set.suggestion!!.suggestedLoadKg!!
        assertEquals(kgToDisplay(canonical, "lb"), draft.loadForSubmission(model, "lb")!!, 0.0)
    }

    @Test
    fun remoteChangesUpdateUntouchedFieldsAndPreserveLocalRepsAndRunningTimer() {
        val model = activeSetModel(snapshot())
        val draft = SetDraft(model.startingReps, model.startingLoad, model.startingRir)
        draft.reps = 12
        draft.startTimer(1_000L)
        draft.reconcile(model.copy(startingReps = 9, startingLoad = 100.0, startingRir = "1", startingSeconds = 45))
        assertEquals(12, draft.reps)
        assertEquals(100.0, draft.load!!, 0.0)
        assertEquals("1", draft.rir)
        assertTrue(draft.timing)
    }

    @Test
    fun conflictComparisonUsesTimeAndHonorsHiddenRir() {
        val timed = formatConflictSet(WorkoutSet(durationSeconds = 45, rir = "2"), "kg", true, true)
        assertFalse(timed.contains("reps"))
        assertFalse(timed.contains("RIR"))
        assertTrue(timed.contains(formatSetSeconds(45)))
        assertFalse(formatConflictSet(WorkoutSet(reps = 8, rir = "2"), "kg", false, false).contains("RIR"))
    }
}
