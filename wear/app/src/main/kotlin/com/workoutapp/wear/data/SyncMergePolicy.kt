package com.workoutapp.wear.data

import com.google.gson.GsonBuilder
import com.google.gson.JsonNull
import com.google.gson.JsonObject
import java.time.Instant

object SyncMergePolicy {
    private val gson = GsonBuilder().serializeNulls().create()

    fun rebaseSet(operation: PendingOperation, remote: WorkoutSession): JsonObject? {
        val request = runCatching { gson.fromJson(operation.requestJson, JsonObject::class.java) }.getOrNull() ?: return null
        val baselineSession = runCatching { gson.fromJson(operation.baselineJson, WorkoutSession::class.java) }.getOrNull() ?: return null
        val baselineSet = findSet(baselineSession, operation.setId) ?: return null
        val remoteSet = findSet(remote, operation.setId) ?: return null
        val fields = listOf("weightKg", "reps", "rpe", "rir", "done", "warmup", "resistanceMode")
        for (field in fields) {
            val baseValue = gson.toJsonTree(readField(baselineSet, field)) ?: JsonNull.INSTANCE
            val remoteValue = gson.toJsonTree(readField(remoteSet, field)) ?: JsonNull.INSTANCE
            if (remoteValue != baseValue) return null
        }
        return request
    }

    fun rebaseTiming(operation: PendingOperation, remote: WorkoutSession): JsonObject? {
        if (!remote.active) return null
        val baseline = readBaseline(operation) ?: return null
        if (!sameInstant(remote.pausedAt, baseline.pausedAt)) return null
        return readRequest(operation)
    }

    fun rebaseFinish(operation: PendingOperation, remote: WorkoutSession): JsonObject? {
        if (!remote.active) return null
        val baseline = readBaseline(operation) ?: return null
        if (remote.copy(revision = baseline.revision) != baseline) return null
        return readRequest(operation)
    }

    private fun readBaseline(operation: PendingOperation): WorkoutSession? =
        runCatching { gson.fromJson(operation.baselineJson, WorkoutSession::class.java) }.getOrNull()

    private fun readRequest(operation: PendingOperation): JsonObject? =
        runCatching { gson.fromJson(operation.requestJson, JsonObject::class.java) }.getOrNull()

    private fun sameInstant(left: String?, right: String?): Boolean {
        if (left == null || right == null) return left == right
        return runCatching { Instant.parse(left) == Instant.parse(right) }.getOrDefault(left == right)
    }

    private fun findSet(session: WorkoutSession, setId: String?): WorkoutSet?
        = session.exercises.asSequence().flatMap { it.sets.asSequence() }.firstOrNull { it.id == setId }

    private fun readField(set: WorkoutSet, field: String): Any? = when (field) {
        "weightKg" -> set.weightKg
        "reps" -> set.reps
        "rpe" -> set.rpe
        "rir" -> set.rir
        "done" -> set.done
        "warmup" -> set.warmup
        "resistanceMode" -> set.resistanceMode
        else -> null
    }
}
