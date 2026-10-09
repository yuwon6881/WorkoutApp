package com.workoutapp.wear.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RestPolicyTest {
    @Test
    fun `rest does not start after the final planned set`() {
        val session = session(exercise("bench", "", listOf(set("s1", 0, done = true))))
        assertFalse(RestPolicy.shouldRestAfter(session, "bench", "s1"))
    }

    @Test
    fun `rest is skipped between superset partners and starts after the round`() {
        val first = exercise("row", "A1", listOf(set("row-1", 0, true), set("row-2", 1)))
        val second = exercise("press", "A2", listOf(set("press-1", 0), set("press-2", 1)))
        val session = session(first, second)

        assertFalse(RestPolicy.shouldRestAfter(session, "row", "row-1"))
        assertTrue(RestPolicy.shouldRestAfter(session, "press", "press-1"))
    }

    @Test
    fun `dropset and myorep notes suppress the rest after that set`() {
        val dropExercise = exercise("drop", "", listOf(
            set("drop-1", 0, true), set("drop-2", 1)
        ), notes = listOf("drop set", null))
        val myoExercise = exercise("myo", "", listOf(
            set("myo-1", 0, true), set("myo-2", 1)
        ), notes = listOf("myorep", null))

        assertFalse(RestPolicy.shouldRestAfter(session(dropExercise), "drop", "drop-1"))
        assertFalse(RestPolicy.shouldRestAfter(session(myoExercise), "myo", "myo-1"))
    }

    @Test
    fun `warmup that is next does not start a working-set rest`() {
        val warmup = SetPrescription(10, 10, warmup = true)
        val exercise = exercise("bench", "", listOf(set("s1", 0, true), set("s2", 1)), prescriptions = listOf(SetPrescription(8, 10), warmup))
        assertFalse(RestPolicy.shouldRestAfter(session(exercise), "bench", "s1"))
    }

    @Test
    fun `a set rests for its own prescribed time when the exercise has no rest timer`() {
        val sets = listOf(set("s1", 0, true), set("s2", 1))
        val planned = exercise("bench", "", sets, prescriptions = listOf(SetPrescription(8, 10, restSeconds = 150), SetPrescription(8, 10, restSeconds = 150)))
        assertEquals(150, RestPolicy.restSecondsAfter(planned, sets[0], accountDefault = 90))
    }

    @Test
    fun `the exercise rest timer wins and the account default fills a gap`() {
        val sets = listOf(set("s1", 0, true), set("s2", 1))
        val timed = exercise("bench", "", sets, prescriptions = listOf(SetPrescription(8, 10, restSeconds = 150), SetPrescription(8, 10)))
            .copy(restSeconds = 120)
        val unplanned = exercise("row", "", sets)
        assertEquals(120, RestPolicy.restSecondsAfter(timed, sets[0], accountDefault = 90))
        assertEquals(75, RestPolicy.restSecondsAfter(unplanned, sets[1], accountDefault = 75))
    }

    private fun session(vararg exercises: WorkoutExercise) = WorkoutSession(exercises = exercises.toList())

    private fun exercise(
        id: String,
        sequenceGroup: String,
        sets: List<WorkoutSet>,
        notes: List<String?> = sets.map { null },
        prescriptions: List<SetPrescription> = sets.mapIndexed { index, _ -> SetPrescription(8, 10, notes = notes[index]) }
    ) = WorkoutExercise(
        id = id,
        name = id,
        position = if (sequenceGroup.endsWith("2")) 1 else 0,
        sequenceGroup = sequenceGroup,
        prescription = prescriptions,
        sets = sets
    )

    private fun set(id: String, position: Int, done: Boolean = false) = WorkoutSet(id = id, position = position, done = done)
}
