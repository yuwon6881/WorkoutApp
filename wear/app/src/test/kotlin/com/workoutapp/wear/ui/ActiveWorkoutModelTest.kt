package com.workoutapp.wear.ui

import com.workoutapp.wear.ui.FakeWorkouts.snapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ActiveWorkoutModelTest {
    @Test
    fun currentSetStartsFromTheServerSuggestionAndTarget() {
        val model = activeSetModel(snapshot())
        assertEquals("bench", model.exercise.id)
        assertEquals(3, model.setNumber)
        assertEquals(5, model.setCount)
        assertEquals("6–8", model.targetReps)
        assertEquals("2", model.targetRir)
        assertEquals(6, model.startingReps)
        assertEquals(82.5, model.startingLoad!!, 0.0)
        assertEquals(82.5, model.suggestedLoad!!, 0.0)
        assertNull(model.startingRir)
        assertTrue(model.loadEditable)
    }

    @Test
    fun unknownLoadIsNeverPresentedAsZero() {
        val model = activeSetModel(snapshot(activeExerciseId = "lateral"))
        assertNull(model.startingLoad)
        assertNull(model.suggestedLoad)
        assertEquals("kg · not recorded", loadCaption(model, null, "kg"))
    }

    @Test
    fun poundsAreADisplayConversionOfCanonicalKilograms() {
        val model = activeSetModel(snapshot(unit = "lb"))
        assertEquals(181.9, model.startingLoad!!, 0.0)
        assertEquals(5.51, model.loadStep, 0.01)
    }

    @Test
    fun bodyweightSetsPassTheirStoredLoadThroughUntouched() {
        val model = activeSetModel(snapshot(activeExerciseId = "dips"))
        assertFalse(model.loadEditable)
        assertEquals("bodyweight", model.resistanceMode)
        assertNull(passthroughLoad(model.set, "kg"))
        val weighted = model.set!!.copy(weightKg = 10.0)
        assertEquals(22.05, passthroughLoad(weighted, "lb")!!, 0.01)
    }

    @Test
    fun warmupSetsAreFlaggedSoRirIsNotRequested() {
        val model = activeSetModel(snapshot(session = FakeWorkouts.warmupFirst))
        assertTrue(model.warmup)
        assertEquals("Next · warm-up", nextUp(snapshot(session = FakeWorkouts.warmupFirst))!!.detail)
    }

    @Test
    fun nextUpPreviewsTheSetThePageWillShowAfterRest() {
        val next = nextUp(snapshot())!!
        assertEquals("Barbell Bench Press", next.exerciseName)
        assertEquals("Next · set 3 of 5", next.detail)
        assertNull(nextUp(snapshot(session = FakeWorkouts.allDone)))
    }

    @Test
    fun progressCountsWorkingSetsOnly() {
        val progress = workoutProgress(FakeWorkouts.session)
        assertEquals(1, progress.doneSets)
        assertEquals(13, progress.plannedSets)
        assertEquals(1f / 13, progress.fraction, 0.0001f)
    }

    @Test
    fun edgeActionFollowsPauseThenSetThenCompletion() {
        val model = activeSetModel(snapshot())
        assertEquals(SetAction.Resume, setAction(model, paused = true, allLogged = false))
        assertEquals(SetAction.Log, setAction(model, paused = false, allLogged = false))
        val done = activeSetModel(snapshot(session = FakeWorkouts.allDone))
        assertEquals(SetAction.Finish, setAction(done, paused = false, allLogged = allSetsLogged(FakeWorkouts.allDone)))
        assertEquals(SetAction.NextExercise, setAction(done, paused = false, allLogged = false))
    }

    @Test
    fun nextIncompleteExerciseWrapsAroundTheSession() {
        assertEquals("incline", nextIncompleteExercise(FakeWorkouts.session, "bench")!!.id)
        assertEquals("bench", nextIncompleteExercise(FakeWorkouts.session, "dips")!!.id)
        assertNull(nextIncompleteExercise(FakeWorkouts.allDone, "bench"))
    }

    @Test
    fun syncStatusSeparatesSavedHereFromConfirmed() {
        assertEquals(SyncTone.Synced, syncStatus(0, pairingRequired = false, syncing = false).tone)
        assertEquals(SyncTone.Pending, syncStatus(2, pairingRequired = false, syncing = false).tone)
        assertEquals("2 to sync", syncStatus(2, pairingRequired = false, syncing = false).label)
        assertEquals(SyncTone.Syncing, syncStatus(2, pairingRequired = false, syncing = true).tone)
        val reconnect = syncStatus(1, pairingRequired = true, syncing = true)
        assertEquals(SyncTone.Attention, reconnect.tone)
        assertEquals("1 change saved on this watch", reconnect.detail)
    }
}
