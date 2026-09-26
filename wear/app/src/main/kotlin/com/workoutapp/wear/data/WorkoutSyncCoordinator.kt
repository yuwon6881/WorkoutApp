package com.workoutapp.wear.data

import android.content.Context
import com.google.gson.GsonBuilder
import com.google.gson.JsonObject
import com.workoutapp.wear.service.WorkoutOngoingService
import java.time.Instant
import java.util.UUID
import kotlin.coroutines.cancellation.CancellationException

/**
 * Replays the watch's queued edits in order. Callers must serialize calls (the repository holds one
 * process-wide gate), because a replay reads the queue head, sends it, then acknowledges it.
 *
 * Failures are classified so the queue never wedges: revision races are rebased, a workout closed
 * on the phone releases its edits, edits WorkoutApp refuses are dropped with a notice, and only
 * transient failures (network, 408, 429, 5xx) are left for a retry.
 */
class WorkoutSyncCoordinator(
    private val context: Context,
    private val store: WorkoutStore,
    private val api: WorkoutGateway
) {
    private val gson = GsonBuilder().serializeNulls().create()

    suspend fun syncPending(): SyncOutcome {
        var rebases = 0
        while (true) {
            val snapshot = store.readSnapshot()
            val operation = store.pendingOperations().firstOrNull() ?: return SyncOutcome()
            if (snapshot?.conflictOperationId != null) return SyncOutcome(conflict = true, pending = true)
            store.markAttempted(operation.sequence)
            val server = try {
                api.send(operation)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: ApiFailure) {
                when (val next = recover(operation, failure, rebases)) {
                    Step.Retry -> { rebases++; continue }
                    Step.Next -> continue
                    is Step.Stop -> return next.outcome
                }
            } catch (failure: Exception) {
                return SyncOutcome(pending = true, message = OFFLINE_MESSAGE)
            }
            if (operation.type == "finish") {
                store.clearAll()
                WorkoutOngoingService.stop(context)
                return SyncOutcome(finished = true)
            }
            store.acknowledge(operation.sequence) { current, remaining ->
                current.copy(
                    session = SessionProjection.project(server, remaining),
                    pendingFinish = remaining.any { it.type == "finish" }
                )
            }
        }
    }

    suspend fun resolveConflict(keepWatchValue: Boolean) {
        val snapshot = store.readSnapshot() ?: return
        val operationId = snapshot.conflictOperationId ?: return
        val remote = snapshot.conflictSession ?: return
        val operation = store.pendingOperations().firstOrNull { it.id == operationId } ?: run {
            store.update { current, _ -> current?.copy(conflictOperationId = null, conflictSession = null) }
            return
        }

        if (keepWatchValue) {
            val id = UUID.randomUUID().toString()
            val request = gson.fromJson(operation.requestJson, JsonObject::class.java)
            request.addProperty("revision", remote.revision)
            request.addProperty("mutationId", id)
            if (operation.type == "pause" || operation.type == "resume") request.addProperty("occurredAt", Instant.now().toString())
            // A same-revision refusal is about the timestamp itself (it no longer follows the last
            // pause or resume), so keeping the watch's finish means finishing now.
            if (operation.type == "finish" && remote.revision == operation.revision) request.addProperty("finishedAt", Instant.now().toString())
            store.rewriteOperation(operation.sequence, id, remote.revision, request.toString(), gson.toJson(remote))
        } else {
            store.removeOperation(operation.sequence)
        }
        store.update { current, remaining ->
            current?.copy(
                session = SessionProjection.project(remote, remaining),
                pendingFinish = remaining.any { it.type == "finish" },
                conflictOperationId = null,
                conflictSession = null
            )
        }
    }

    private sealed interface Step {
        data object Retry : Step
        data object Next : Step
        data class Stop(val outcome: SyncOutcome) : Step
    }

    private suspend fun recover(operation: PendingOperation, failure: ApiFailure, rebases: Int): Step = when (failure.statusCode) {
        401 -> Step.Stop(SyncOutcome(pending = true, sessionExpired = true, message = failure.message))
        404, 409 -> reconcile(operation, failure, rebases)
        400, 403, 422 -> {
            reject(operation, failure.message ?: "WorkoutApp could not accept a change from the watch.")
            Step.Next
        }
        else -> Step.Stop(SyncOutcome(pending = true, message = failure.message ?: OFFLINE_MESSAGE))
    }

    /** Reads the live workout to learn why an edit was refused, then rebases, reviews, or releases it. */
    private suspend fun reconcile(operation: PendingOperation, failure: ApiFailure, rebases: Int): Step {
        val remote = try {
            api.workout(operation.sessionId)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (lookup: ApiFailure) {
            return when (lookup.statusCode) {
                404 -> { closeSession(operation.sessionId); Step.Next }
                401 -> Step.Stop(SyncOutcome(pending = true, sessionExpired = true, message = lookup.message))
                else -> Step.Stop(SyncOutcome(pending = true, message = failure.message))
            }
        } catch (lookup: Exception) {
            return Step.Stop(SyncOutcome(pending = true, message = OFFLINE_MESSAGE))
        }

        if (operation.type == "set" && remote.exercises.none { exercise -> exercise.sets.any { it.id == operation.setId } }) {
            reject(operation, "A set logged on the watch was removed in WorkoutApp, so it was not saved.", remote)
            return Step.Next
        }
        // The same revision means the refusal was not a race another device won; resending the same
        // request would be refused again, so the lifter decides instead of the loop.
        if (remote.revision == operation.revision || rebases >= MAX_REBASES_PER_SYNC) {
            store.setConflict(operation.id, remote)
            return Step.Stop(SyncOutcome(conflict = true, pending = true, message = failure.message))
        }
        val rebased = when (operation.type) {
            "set" -> SyncMergePolicy.rebaseSet(operation, remote)
            "pause", "resume" -> SyncMergePolicy.rebaseTiming(operation, remote)
            "finish" -> SyncMergePolicy.rebaseFinish(operation, remote)
            else -> null
        }
        if (rebased == null) {
            store.setConflict(operation.id, remote)
            val message = when (operation.type) {
                "set" -> "WorkoutApp changed this same set. Review both values before syncing."
                "finish" -> "WorkoutApp changed the workout before the watch finished it. Review both versions before syncing."
                else -> "WorkoutApp changed the workout timing. Review both versions before syncing."
            }
            return Step.Stop(SyncOutcome(conflict = true, pending = true, message = message))
        }
        val mutationId = UUID.randomUUID().toString()
        rebased.addProperty("revision", remote.revision)
        rebased.addProperty("mutationId", mutationId)
        store.rewriteOperation(operation.sequence, mutationId, remote.revision, rebased.toString(), gson.toJson(remote))
        store.update { current, remaining -> current?.copy(session = SessionProjection.project(remote, remaining)) }
        return Step.Retry
    }

    /** Drops one edit WorkoutApp will never accept and re-reads the workout so the screen matches it. */
    private suspend fun reject(operation: PendingOperation, reason: String, knownRemote: WorkoutSession? = null) {
        store.removeOperation(operation.sequence)
        store.postNotice(reason)
        val remote = knownRemote ?: try {
            api.workout(operation.sessionId)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (lookup: ApiFailure) {
            if (lookup.statusCode == 404) closeSession(operation.sessionId)
            null
        } catch (lookup: Exception) {
            null
        } ?: return
        store.update { current, remaining ->
            if (current?.session?.id != remote.id) current
            else current.copy(session = SessionProjection.project(remote, remaining), pendingFinish = remaining.any { it.type == "finish" })
        }
    }

    /**
     * The workout was finished or discarded in WorkoutApp. Its saved history belongs to the phone, so
     * the watch releases its queued edits for it and says how many were not added.
     */
    private fun closeSession(sessionId: String) {
        val released = store.pendingOperations().filter { it.sessionId == sessionId }
        released.forEach { store.removeOperation(it.sequence) }
        val cleared = store.update { current, _ -> if (current?.session?.id == sessionId) null else current } == null
        if (cleared) WorkoutOngoingService.stop(context)
        val lostEdits = released.count { it.type != "finish" }
        store.postNotice(when {
            lostEdits > 0 -> "This workout was closed in WorkoutApp, so ${countLabel(lostEdits, "change")} from the watch could not be added."
            released.any { it.type == "finish" } -> "WorkoutApp had already saved this workout."
            else -> "This workout was closed in WorkoutApp."
        })
    }

    private fun countLabel(count: Int, noun: String) = "$count ${if (count == 1) noun else "${noun}s"}"

    companion object {
        private const val MAX_REBASES_PER_SYNC = 3
        const val OFFLINE_MESSAGE = "Waiting for a connection to sync this workout."
    }
}

data class SyncOutcome(
    val finished: Boolean = false,
    val conflict: Boolean = false,
    val pending: Boolean = false,
    val message: String? = null,
    val sessionExpired: Boolean = false,
    val needsPairing: Boolean = false
)
