package com.workoutapp.wear.data

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.JsonParser

/**
 * Words for queued edits the watch has to drop, so the lifter can re-enter what was logged: dropping
 * an edit is only acceptable when its values are still readable afterwards.
 */
object LostEditSummary {
    private const val LB_PER_KG = 2.2046226218
    private const val MAX_LISTED = 3
    private val gson = Gson()

    /** "Bench press 60 kg × 8" for a logged set, or null for edits that carry no values worth keeping. */
    fun describe(operation: PendingOperation, unit: String): String? {
        if (operation.type != "set") return null
        val request = runCatching { JsonParser.parseString(operation.requestJson).asJsonObject }.getOrNull() ?: return null
        if (request.get("done")?.takeIf { !it.isJsonNull }?.asBoolean == false) return null
        val name = exerciseName(operation) ?: "A set"
        val parts = listOfNotNull(
            number(request, "weightKg")?.let { kg -> formatLoad(kg, unit) },
            number(request, "reps")?.let { "× ${it.toInt()}" },
            number(request, "durationSeconds")?.let { "${it.toInt()} s" }
        )
        return if (parts.isEmpty()) name else "$name ${parts.joinToString(" ")}"
    }

    /** The first few descriptions, with a count for the rest; empty when nothing carried values. */
    fun list(operations: List<PendingOperation>, unit: String): String {
        val described = operations.mapNotNull { describe(it, unit) }
        if (described.isEmpty()) return ""
        val shown = described.take(MAX_LISTED).joinToString("; ")
        val more = described.size - MAX_LISTED
        return if (more > 0) "$shown; +$more more" else shown
    }

    private fun exerciseName(operation: PendingOperation): String? {
        val setId = operation.setId ?: return null
        val baseline = runCatching { gson.fromJson(operation.baselineJson, WorkoutSession::class.java) }.getOrNull() ?: return null
        return baseline.exercises.firstOrNull { exercise -> exercise.sets.any { it.id == setId } }?.name?.takeIf { it.isNotBlank() }
    }

    private fun number(request: JsonObject, key: String): Double? =
        request.get(key)?.takeIf { !it.isJsonNull }?.runCatching { asDouble }?.getOrNull()

    private fun formatLoad(kg: Double, unit: String): String {
        val value = if (unit == "lb") kg * LB_PER_KG else kg
        val rounded = Math.round(value * 10) / 10.0
        val text = if (rounded == rounded.toLong().toDouble()) rounded.toLong().toString() else rounded.toString()
        return "$text $unit"
    }
}
