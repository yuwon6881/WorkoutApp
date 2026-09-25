package com.workoutapp.wear.data

import android.content.Context
import com.google.gson.GsonBuilder
import com.google.gson.JsonObject
import java.time.Instant
import java.util.UUID
import com.workoutapp.wear.service.WorkoutOngoingService

class WorkoutSyncCoordinator(
    private val context: Context,
    private val store: WorkoutStore,
    private val api: WorkoutGateway
) {
    private val gson = GsonBuilder().serializeNulls().create()

    suspend fun syncPending(): SyncOutcome {
        while (true) {
            val snapshot = store.readSnapshot() ?: return SyncOutcome()
            if (snapshot.conflictOperationId != null) return SyncOutcome(conflict = true, pending = store.pendingOperations().isNotEmpty())
            val operation = store.pendingOperations().firstOrNull() ?: return SyncOutcome(pending = false)
            store.markAttempted(operation.sequence)
            val current = store.pendingOperations().firstOrNull() ?: return SyncOutcome()
            try {
                val server = api.send(current)
                if (current.type == "finish") {
                    store.clearAll()
                    WorkoutOngoingService.stop(context)
                    return SyncOutcome(finished = true)
                }
                val restOfQueue = store.pendingOperations().filterNot { it.sequence == current.sequence }
                val local = project(server, restOfQueue)
                val next = snapshot.copy(session = local, pendingFinish = restOfQueue.any { it.type == "finish" })
                store.acknowledge(current.sequence, next)
            } catch (failure: ApiFailure) {
                if (failure.statusCode == 401) {
                    return SyncOutcome(pending = true, sessionExpired = true, message = failure.message)
                }
                if (failure.statusCode == 409) {
                    val remote = runCatching { api.workout(current.sessionId) }.getOrNull()
                        ?: return SyncOutcome(pending = true, message = failure.message)
                    if (current.type == "set" && !remote.active || current.type == "finish" && !remote.active) {
                        store.setConflict(current.id, remote)
                        return SyncOutcome(conflict = true, pending = true, message = failure.message)
                    }
                    val rebased = when (current.type) {
                        "set" -> SyncMergePolicy.rebaseSet(current, remote)
                        "pause", "resume" -> SyncMergePolicy.rebaseTiming(current, remote)
                        "finish" -> SyncMergePolicy.rebaseFinish(current, remote)
                        else -> null
                    }
                    if (current.type == "set" && rebased == null) {
                        store.setConflict(current.id, remote)
                        return SyncOutcome(conflict = true, pending = true, message = "WorkoutApp changed this same set. Review both values before syncing.")
                    }
                    if (rebased == null) {
                        store.setConflict(current.id, remote)
                        val message = if (current.type == "finish")
                            "WorkoutApp changed the workout before the watch finished it. Review both versions before syncing."
                        else "WorkoutApp changed the workout timing. Review both versions before syncing."
                        return SyncOutcome(conflict = true, pending = true, message = message)
                    }
                    val request = rebased
                    val mutationId = UUID.randomUUID().toString()
                    request.addProperty("revision", remote.revision)
                    request.addProperty("mutationId", mutationId)
                    store.rewriteOperation(current.sequence, mutationId, remote.revision, request.toString(), gson.toJson(remote))
                    store.saveSnapshot(snapshot.copy(session = project(remote, store.pendingOperations()), conflictOperationId = null, conflictSession = null))
                    continue
                }
                return SyncOutcome(pending = true, message = failure.message)
            } catch (failure: Exception) {
                return SyncOutcome(pending = true, message = failure.message ?: "Waiting for a connection to sync this workout.")
            }
        }
    }

    suspend fun resolveConflict(keepWatchValue: Boolean) {
        val snapshot = store.readSnapshot() ?: return
        val operationId = snapshot.conflictOperationId ?: return
        val remote = snapshot.conflictSession ?: return
        val operation = store.pendingOperations().firstOrNull { it.id == operationId } ?: return

        if (keepWatchValue && (operation.type != "finish" || remote.active)) {
            val id = UUID.randomUUID().toString()
            val request = gson.fromJson(operation.requestJson, JsonObject::class.java)
            request.addProperty("revision", remote.revision)
            request.addProperty("mutationId", id)
            if (operation.type == "pause" || operation.type == "resume") request.addProperty("occurredAt", Instant.now().toString())
            store.rewriteOperation(operation.sequence, id, remote.revision, request.toString(), gson.toJson(remote))
            val projected = project(remote, store.pendingOperations())
            store.clearConflict(snapshot.copy(session = projected, pendingFinish = operation.type == "finish"))
        } else {
            store.removeOperation(operation.sequence)
            val remaining = store.pendingOperations()
            val projected = project(remote, remaining)
            store.clearConflict(snapshot.copy(session = projected, pendingFinish = remaining.any { it.type == "finish" }))
        }
    }

    private fun project(remote: WorkoutSession, operations: List<PendingOperation>): WorkoutSession {
        var session = remote
        for (operation in operations.sortedBy { it.sequence }) {
            when (operation.type) {
                "set" -> {
                    val request = runCatching { gson.fromJson(operation.requestJson, JsonObject::class.java) }.getOrNull() ?: continue
                    val exercise = session.exercises.firstOrNull { row -> row.sets.any { it.id == operation.setId } } ?: continue
                    val set = exercise.sets.firstOrNull { it.id == operation.setId } ?: continue
                    val patched = set.copy(
                        weightKg = nullableDouble(request, "weightKg", set.weightKg),
                        reps = nullableInt(request, "reps", set.reps),
                        rpe = nullableDouble(request, "rpe", set.rpe),
                        rir = nullableString(request, "rir", set.rir),
                        done = request.get("done")?.asBoolean ?: set.done,
                        warmup = request.get("warmup")?.asBoolean ?: set.warmup,
                        resistanceMode = request.get("resistanceMode")?.asString ?: set.resistanceMode
                    )
                    val exercises = session.exercises.map { row ->
                        if (row.id == exercise.id) row.copy(sets = row.sets.map { if (it.id == set.id) patched else it }) else row
                    }
                    session = withCounts(session.copy(exercises = exercises))
                }
                "pause" -> {
                    val request = gson.fromJson(operation.requestJson, JsonObject::class.java)
                    session = session.copy(pausedAt = request.get("occurredAt")?.asString)
                }
                "resume" -> session = session.copy(pausedAt = null)
                "finish" -> {
                    val request = gson.fromJson(operation.requestJson, JsonObject::class.java)
                    session = session.copy(active = false, finishedAt = request.get("finishedAt")?.asString)
                }
            }
        }
        return session
    }

    private fun withCounts(session: WorkoutSession) = session.copy(
        completedSets = session.exercises.sumOf { exercise -> exercise.sets.count { it.done && !it.warmup } },
        warmupSets = session.exercises.sumOf { exercise -> exercise.sets.count { it.done && it.warmup } }
    )

    private fun nullableDouble(json: JsonObject, key: String, fallback: Double?): Double?
        = if (!json.has(key) || json.get(key).isJsonNull) fallback else json.get(key).asDouble

    private fun nullableInt(json: JsonObject, key: String, fallback: Int?): Int?
        = if (!json.has(key) || json.get(key).isJsonNull) fallback else json.get(key).asInt

    private fun nullableString(json: JsonObject, key: String, fallback: String?): String?
        = if (!json.has(key) || json.get(key).isJsonNull) fallback else json.get(key).asString
}

data class SyncOutcome(
    val finished: Boolean = false,
    val conflict: Boolean = false,
    val pending: Boolean = false,
    val message: String? = null,
    val sessionExpired: Boolean = false,
    val needsPairing: Boolean = false
)
