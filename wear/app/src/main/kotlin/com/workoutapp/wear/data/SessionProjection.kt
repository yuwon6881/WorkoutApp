package com.workoutapp.wear.data

import com.google.gson.GsonBuilder
import com.google.gson.JsonObject

/**
 * Replays queued watch edits over a server session so the screen shows what the lifter did even
 * before WorkoutApp confirms it. Every path that adopts a server copy goes through here; skipping it
 * would make a logged-but-unsynced set briefly read as not done.
 */
object SessionProjection {
    private val gson = GsonBuilder().serializeNulls().create()

    fun project(remote: WorkoutSession, operations: List<PendingOperation>): WorkoutSession {
        var session = remote
        for (operation in operations.sortedBy { it.sequence }) {
            if (operation.sessionId != remote.id) continue
            val request = runCatching { gson.fromJson(operation.requestJson, JsonObject::class.java) }.getOrNull() ?: continue
            session = when (operation.type) {
                "set" -> applySet(session, operation.setId, request)
                "pause" -> session.copy(pausedAt = request.get("occurredAt")?.asString)
                "resume" -> session.copy(pausedAt = null)
                "finish" -> session.copy(active = false, finishedAt = request.get("finishedAt")?.asString)
                else -> session
            }
        }
        return session
    }

    fun withCounts(session: WorkoutSession): WorkoutSession = session.copy(
        completedSets = session.exercises.sumOf { exercise -> exercise.sets.count { it.done && !it.warmup } },
        warmupSets = session.exercises.sumOf { exercise -> exercise.sets.count { it.done && it.warmup } }
    )

    private fun applySet(session: WorkoutSession, setId: String?, request: JsonObject): WorkoutSession {
        val exercise = session.exercises.firstOrNull { row -> row.sets.any { it.id == setId } } ?: return session
        val exercises = session.exercises.map { row ->
            if (row.id != exercise.id) row else row.copy(sets = row.sets.map { set ->
                if (set.id != setId) set else set.copy(
                    weightKg = nullableDouble(request, "weightKg", set.weightKg),
                    reps = nullableInt(request, "reps", set.reps),
                    rpe = nullableDouble(request, "rpe", set.rpe),
                    rir = nullableString(request, "rir", set.rir),
                    done = request.get("done")?.asBoolean ?: set.done
                )
            })
        }
        return withCounts(session.copy(exercises = exercises))
    }

    // An explicit null clears the value; only an absent field keeps the server's copy.
    private fun nullableDouble(json: JsonObject, key: String, fallback: Double?): Double? = when {
        !json.has(key) -> fallback
        json.get(key).isJsonNull -> null
        else -> json.get(key).asDouble
    }

    private fun nullableInt(json: JsonObject, key: String, fallback: Int?): Int? = when {
        !json.has(key) -> fallback
        json.get(key).isJsonNull -> null
        else -> json.get(key).asInt
    }

    private fun nullableString(json: JsonObject, key: String, fallback: String?): String? = when {
        !json.has(key) -> fallback
        json.get(key).isJsonNull -> null
        else -> json.get(key).asString
    }
}
