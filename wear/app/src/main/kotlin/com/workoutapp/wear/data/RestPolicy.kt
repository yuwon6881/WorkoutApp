package com.workoutapp.wear.data

object RestPolicy {
    fun shouldRestAfter(session: WorkoutSession, exerciseId: String, setId: String): Boolean {
        val currentExercise = session.exercises.firstOrNull { it.id == exerciseId } ?: return false
        val setIndex = currentExercise.sets.indexOfFirst { it.id == setId }
        if (setIndex < 0) return false
        val currentPrescription = currentExercise.prescription.getOrNull(currentExercise.sets[setIndex].position)
        if (hasNoRestNote(currentPrescription?.notes)) return false

        val currentGroup = supersetGroup(currentExercise.sequenceGroup)
        var nextExercise: WorkoutExercise? = null
        var nextSet: WorkoutSet? = null

        if (currentGroup.isNotEmpty()) {
            val partners = session.exercises.filter { supersetGroup(it.sequenceGroup) == currentGroup }
                .sortedBy { supersetOrder(it.sequenceGroup, it.position) }
            val partnerIndex = partners.indexOfFirst { it.id == currentExercise.id }
            if (partnerIndex in 0 until partners.lastIndex) {
                val partner = partners[partnerIndex + 1]
                val candidate = partner.sets.getOrNull(setIndex)?.takeIf { !it.done }
                    ?: partner.sets.firstOrNull { !it.done }
                if (candidate != null) { nextExercise = partner; nextSet = candidate }
            } else if (partnerIndex == partners.lastIndex && partners.isNotEmpty()) {
                val first = partners.first()
                val candidate = first.sets.getOrNull(setIndex + 1)?.takeIf { !it.done }
                if (candidate != null) { nextExercise = first; nextSet = candidate }
            }
        }

        if (nextSet == null) {
            for (index in setIndex + 1 until currentExercise.sets.size) {
                if (!currentExercise.sets[index].done) {
                    nextExercise = currentExercise
                    nextSet = currentExercise.sets[index]
                    break
                }
            }
        }
        if (nextSet == null) {
            val exercisePosition = session.exercises.indexOfFirst { it.id == currentExercise.id }
            for (index in exercisePosition + 1 until session.exercises.size) {
                val exercise = session.exercises[index]
                val candidate = exercise.sets.firstOrNull { !it.done }
                if (candidate != null) { nextExercise = exercise; nextSet = candidate; break }
            }
        }

        val followingExercise = nextExercise ?: return false
        val followingSet = nextSet ?: return false
        val prescription = followingExercise.prescription.getOrNull(followingSet.position)
        if (followingSet.warmup || prescription?.warmup == true) return false
        if (hasNoRestNote(prescription?.notes)) return false
        val nextGroup = supersetGroup(followingExercise.sequenceGroup)
        return !(currentGroup.isNotEmpty() && currentGroup == nextGroup &&
            supersetOrder(currentExercise.sequenceGroup, currentExercise.position) <
            supersetOrder(followingExercise.sequenceGroup, followingExercise.position))
    }

    private fun supersetGroup(value: String): String = Regex("^[A-Za-z]+")
        .find(value.trim())?.value?.uppercase().orEmpty()

    private fun supersetOrder(value: String, position: Int): Int
        = Regex("\\d+").find(value)?.value?.toIntOrNull() ?: position + 1

    private fun hasNoRestNote(value: String?): Boolean {
        val notes = value.orEmpty().lowercase()
        return notes.contains("dropset") || notes.contains("drop set") || notes.contains("myorep")
    }
}
