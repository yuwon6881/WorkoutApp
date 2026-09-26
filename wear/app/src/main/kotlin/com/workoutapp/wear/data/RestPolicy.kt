package com.workoutapp.wear.data

data class NextSet(val exercise: WorkoutExercise, val set: WorkoutSet)

object RestPolicy {
    fun shouldRestAfter(session: WorkoutSession, exerciseId: String, setId: String): Boolean {
        val currentExercise = session.exercises.firstOrNull { it.id == exerciseId } ?: return false
        val setIndex = currentExercise.sets.indexOfFirst { it.id == setId }
        if (setIndex < 0) return false
        val currentPrescription = currentExercise.prescription.getOrNull(currentExercise.sets[setIndex].position)
        if (hasNoRestNote(currentPrescription?.notes)) return false

        val next = nextSet(session, exerciseId, setId) ?: return false
        val prescription = next.exercise.prescription.getOrNull(next.set.position)
        if (next.set.warmup || prescription?.warmup == true) return false
        if (hasNoRestNote(prescription?.notes)) return false
        val currentGroup = supersetGroup(currentExercise.sequenceGroup)
        val nextGroup = supersetGroup(next.exercise.sequenceGroup)
        return !(currentGroup.isNotEmpty() && currentGroup == nextGroup &&
            supersetOrder(currentExercise.sequenceGroup, currentExercise.position) <
            supersetOrder(next.exercise.sequenceGroup, next.exercise.position))
    }

    /**
     * The set a lifter moves to after this one, in session order: the next superset partner first,
     * then the rest of this exercise, then later exercises. Null after the session's final set.
     */
    fun nextSet(session: WorkoutSession, exerciseId: String, setId: String): NextSet? {
        val currentExercise = session.exercises.firstOrNull { it.id == exerciseId } ?: return null
        val setIndex = currentExercise.sets.indexOfFirst { it.id == setId }
        if (setIndex < 0) return null

        val currentGroup = supersetGroup(currentExercise.sequenceGroup)
        if (currentGroup.isNotEmpty()) {
            val partners = session.exercises.filter { supersetGroup(it.sequenceGroup) == currentGroup }
                .sortedBy { supersetOrder(it.sequenceGroup, it.position) }
            val partnerIndex = partners.indexOfFirst { it.id == currentExercise.id }
            if (partnerIndex in 0 until partners.lastIndex) {
                val partner = partners[partnerIndex + 1]
                val candidate = partner.sets.getOrNull(setIndex)?.takeIf { !it.done }
                    ?: partner.sets.firstOrNull { !it.done }
                if (candidate != null) return NextSet(partner, candidate)
            } else if (partnerIndex == partners.lastIndex && partners.size > 1) {
                val first = partners.first()
                val candidate = first.sets.getOrNull(setIndex + 1)?.takeIf { !it.done }
                if (candidate != null) return NextSet(first, candidate)
            }
        }

        for (index in setIndex + 1 until currentExercise.sets.size) {
            val candidate = currentExercise.sets[index]
            if (!candidate.done) return NextSet(currentExercise, candidate)
        }
        val exercisePosition = session.exercises.indexOfFirst { it.id == currentExercise.id }
        for (index in exercisePosition + 1 until session.exercises.size) {
            val exercise = session.exercises[index]
            val candidate = exercise.sets.firstOrNull { !it.done }
            if (candidate != null) return NextSet(exercise, candidate)
        }
        return null
    }

    /** Where the set page should go next: the next set in order, else anything skipped earlier. */
    fun nextExerciseId(session: WorkoutSession, exerciseId: String, setId: String): String =
        nextSet(session, exerciseId, setId)?.exercise?.id
            ?: session.exercises.firstOrNull { row -> row.sets.any { !it.done } }?.id
            ?: exerciseId

    private fun supersetGroup(value: String): String = Regex("^[A-Za-z]+")
        .find(value.trim())?.value?.uppercase().orEmpty()

    private fun supersetOrder(value: String, position: Int): Int
        = Regex("\\d+").find(value)?.value?.toIntOrNull() ?: position + 1

    private fun hasNoRestNote(value: String?): Boolean {
        val notes = value.orEmpty().lowercase()
        return notes.contains("dropset") || notes.contains("drop set") || notes.contains("myorep")
    }
}
