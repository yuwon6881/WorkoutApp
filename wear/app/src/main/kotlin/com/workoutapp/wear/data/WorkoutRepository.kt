package com.workoutapp.wear.data

import android.content.Context
import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.google.gson.JsonObject
import com.workoutapp.wear.service.WorkoutOngoingService
import java.time.Instant
import java.util.UUID
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.workoutapp.wear.worker.WorkoutSyncWorker

class WorkoutRepository(context: Context) {
    private val application = context.applicationContext
    val store = WorkoutStore(application)
    val secureStore = SecureTokenStore(application)
    private val api = WorkoutApi(com.workoutapp.wear.BuildConfig.API_BASE_URL, secureStore)
    private val sync = WorkoutSyncCoordinator(application, store, api)
    private val gson: Gson = GsonBuilder().serializeNulls().create()

    fun cached(): WorkoutSnapshot? = store.readSnapshot()

    suspend fun refresh(): WorkoutSnapshot? {
        if (!secureStore.isDevicePaired() || secureStore.pendingPairing() != null) return store.readSnapshot()
        if (store.pendingOperations().isNotEmpty()) {
            syncPending()
            val local = store.readSnapshot()
            if (local?.conflictOperationId != null || local?.pendingFinish == true && store.pendingOperations().isNotEmpty()) return local
        }
        val active = try {
            api.active()
        } catch (failure: ApiFailure) {
            if (failure.statusCode == 401) secureStore.clearDeviceSession()
            throw failure
        }
        val local = store.readSnapshot()
        val remote = active.session
        if (remote == null) {
            if (local != null && (store.pendingOperations().isNotEmpty() || local.pendingFinish || local.conflictOperationId != null)) return local
            store.clearAll()
            WorkoutOngoingService.stop(application)
            return null
        }
        if (local != null && local.session.id != remote.id && store.pendingOperations().isNotEmpty()) {
            val first = store.pendingOperations().first()
            store.setConflict(first.id, remote)
            return store.readSnapshot()
        }
        val nextExercise = remote.exercises.firstOrNull { exercise -> exercise.sets.any { !it.done } }?.id
        val snapshot = if (local?.session?.id == remote.id) local.copy(
            session = remote,
            unit = active.unit,
            defaultRestSeconds = active.restSeconds,
            activeExerciseId = local.activeExerciseId ?: nextExercise
        ) else WorkoutSnapshot(remote, active.unit, active.restSeconds, activeExerciseId = nextExercise)
        store.saveSnapshot(snapshot)
        WorkoutOngoingService.start(application, remote.name)
        return snapshot
    }

    fun resumeBackgroundTracking() {
        val snapshot = store.readSnapshot() ?: return
        if (!snapshot.session.active && !snapshot.pendingFinish) return
        WorkoutOngoingService.start(application, snapshot.session.name)
    }

    suspend fun beginPairing(): PairingStart {
        val pairing = api.startPairing()
        secureStore.savePendingPairing(pairing.pairingId, pairing.code, pairing.expiresAt)
        return pairing
    }

    suspend fun pollPairing(): PairingStatus {
        val pairing = secureStore.pendingPairing() ?: throw IllegalStateException("Start pairing again on your watch.")
        val status = api.pairingStatus(pairing.first)
        if (status.status == "approved") {
            secureStore.markPaired()
            secureStore.clearPendingPairing()
            scheduleSync(force = true)
        }
        if (status.status == "expired") {
            secureStore.clearDeviceSession()
            secureStore.clearPendingPairing()
        }
        return status
    }

    suspend fun logSet(exerciseId: String, setId: String, reps: Int, displayWeight: Double?, rir: String?) {
        require(reps > 0) { "Enter the reps you completed." }
        require(displayWeight == null || displayWeight >= 0) { "Load cannot be negative." }
        val snapshot = requireSnapshot()
        check(snapshot.session.active && snapshot.session.pausedAt == null && !snapshot.pendingFinish) { "Resume the workout before logging a set." }
        val exercise = snapshot.session.exercises.firstOrNull { it.id == exerciseId } ?: error("This exercise is no longer in the workout.")
        val set = exercise.sets.firstOrNull { it.id == setId } ?: error("This set is no longer in the workout.")
        val weightKg = displayWeight?.let { if (snapshot.unit == "lb") it / LB_PER_KG else it }
        val actualRir = RirPolicy.normalize(rir, set.warmup)
        val patch = SetPatch(weightKg, reps, RirPolicy.toRpe(actualRir), actualRir, true, set.warmup, set.resistanceMode)
        queueSetPatch(snapshot, exercise, set, patch)
    }

    suspend fun undoSet(exerciseId: String, setId: String) {
        val snapshot = requireSnapshot()
        val exercise = snapshot.session.exercises.firstOrNull { it.id == exerciseId } ?: error("This exercise is no longer in the workout.")
        val set = exercise.sets.firstOrNull { it.id == setId } ?: error("This set is no longer in the workout.")
        val patch = SetPatch(set.weightKg, set.reps, set.rpe, set.rir, false, set.warmup, set.resistanceMode)
        queueSetPatch(snapshot, exercise, set, patch)
    }

    suspend fun pause() = changePauseState(true)
    suspend fun resume() = changePauseState(false)

    suspend fun finish() {
        val snapshot = requireSnapshot()
        check(snapshot.session.active && !snapshot.pendingFinish) { "This workout is already finished on the watch." }
        val finishedAt = Instant.now().toString()
        val mutationId = UUID.randomUUID().toString()
        val request = JsonObject().apply {
            addProperty("revision", snapshot.session.revision)
            addProperty("mutationId", mutationId)
            addProperty("finishedAt", finishedAt)
        }
        val locallyFinished = snapshot.copy(
            session = snapshot.session.copy(active = false, finishedAt = finishedAt),
            restEndsAtEpochMs = null,
            restGeneration = null,
            pausedRestRemainingMs = null,
            pendingFinish = true
        )
        store.enqueue(locallyFinished, PendingOperation(
            sequence = 0,
            id = mutationId,
            type = "finish",
            sessionId = snapshot.session.id,
            revision = snapshot.session.revision,
            requestJson = request.toString(),
            baselineJson = gson.toJson(snapshot.session),
            createdAt = finishedAt,
            attempted = false
        ))
        WorkoutOngoingService.update(application, snapshot.session.name)
        scheduleSync()
    }

    fun startRest(seconds: Int): WorkoutSnapshot? {
        val snapshot = store.readSnapshot() ?: return null
        if (seconds <= 0 || snapshot.session.pausedAt != null || snapshot.pendingFinish) return skipRest()
        val generation = UUID.randomUUID().toString()
        val deadline = System.currentTimeMillis() + seconds * 1_000L
        val next = snapshot.copy(restEndsAtEpochMs = deadline, restGeneration = generation,
            alertedRestGeneration = null, pausedRestRemainingMs = null)
        store.saveSnapshot(next)
        WorkoutOngoingService.startRest(application, snapshot.session.name)
        return next
    }

    fun extendRest(seconds: Int = 30): WorkoutSnapshot? {
        val snapshot = store.readSnapshot() ?: return null
        if (!snapshot.session.active || snapshot.session.pausedAt != null || snapshot.pendingFinish || seconds <= 0) return snapshot
        val oldDeadline = snapshot.restEndsAtEpochMs
        val newDeadline = (oldDeadline?.coerceAtLeast(System.currentTimeMillis()) ?: System.currentTimeMillis()) + seconds * 1_000L
        val generation = UUID.randomUUID().toString()
        val next = snapshot.copy(restEndsAtEpochMs = newDeadline, restGeneration = generation,
            alertedRestGeneration = null, pausedRestRemainingMs = null)
        store.saveSnapshot(next)
        WorkoutOngoingService.startRest(application, snapshot.session.name)
        return next
    }

    fun skipRest(): WorkoutSnapshot? {
        val snapshot = store.readSnapshot() ?: return null
        val next = snapshot.copy(restEndsAtEpochMs = null, restGeneration = null, pausedRestRemainingMs = null, alertedRestGeneration = null)
        store.saveSnapshot(next)
        WorkoutOngoingService.update(application, snapshot.session.name)
        return next
    }

    suspend fun syncPending(): SyncOutcome {
        if (store.pendingOperations().isNotEmpty() &&
            (!secureStore.isDevicePaired() || secureStore.pendingPairing() != null)) {
            return SyncOutcome(pending = true, needsPairing = true, message = "Pair this watch again to sync saved changes.")
        }
        val outcome = sync.syncPending()
        if (outcome.sessionExpired) secureStore.clearDeviceSession()
        return outcome
    }

    suspend fun resolveConflict(keepWatchValue: Boolean) {
        sync.resolveConflict(keepWatchValue)
        syncPending()
    }

    suspend fun disconnect() {
        check(store.pendingOperations().isEmpty()) { "Sync or review pending workout changes before disconnecting this watch." }
        try {
            api.revoke()
        } catch (failure: ApiFailure) {
            if (failure.statusCode != 401) throw failure
        }
        secureStore.clearToken()
        secureStore.clearPendingPairing()
        store.clearAll()
        WorkoutOngoingService.stop(application)
    }

    private suspend fun changePauseState(pause: Boolean) {
        val snapshot = requireSnapshot()
        check(snapshot.session.active && !snapshot.pendingFinish) { "This workout is already finished." }
        check(if (pause) snapshot.session.pausedAt == null else snapshot.session.pausedAt != null) {
            if (pause) "This workout is already paused." else "Resume is only available while the workout is paused."
        }
        val occurredAt = Instant.now()
        val id = UUID.randomUUID().toString()
        val request = JsonObject().apply {
            addProperty("revision", snapshot.session.revision)
            addProperty("mutationId", id)
            addProperty("occurredAt", occurredAt.toString())
        }
        val nowEpochMs = System.currentTimeMillis()
        val pausedRest = if (pause) snapshot.restEndsAtEpochMs?.let { RestTimerPolicy.remainingMs(it, nowEpochMs) } else null
        val resumedDeadline = if (pause) null else RestTimerPolicy.resumeDeadline(snapshot.pausedRestRemainingMs, nowEpochMs)
        val nextSession = if (pause) snapshot.session.copy(pausedAt = occurredAt.toString()) else snapshot.session.copy(
            pausedAt = null,
            pausedSeconds = snapshot.session.pausedSeconds + snapshot.session.pausedAt?.let {
                ((occurredAt.toEpochMilli() - Instant.parse(it).toEpochMilli()).coerceAtLeast(0) / 1_000L)
            }.orZero()
        )
        val next = snapshot.copy(
            session = nextSession,
            restEndsAtEpochMs = resumedDeadline,
            pausedRestRemainingMs = if (pause) pausedRest else null,
            restGeneration = if (resumedDeadline != null) UUID.randomUUID().toString() else null
        )
        store.enqueue(next, PendingOperation(0, id, if (pause) "pause" else "resume", snapshot.session.id,
            revision = snapshot.session.revision, requestJson = request.toString(), baselineJson = gson.toJson(snapshot.session),
            createdAt = occurredAt.toString(), attempted = false))
        if (pause) WorkoutOngoingService.update(application, snapshot.session.name)
        else if (resumedDeadline != null) WorkoutOngoingService.startRest(application, snapshot.session.name)
        else WorkoutOngoingService.start(application, snapshot.session.name)
        scheduleSync()
    }

    private fun queueSetPatch(snapshot: WorkoutSnapshot, exercise: WorkoutExercise, set: WorkoutSet, patch: SetPatch) {
        val updated = snapshot.session.exercises.map { current ->
            if (current.id != exercise.id) current else current.copy(sets = current.sets.map { if (it.id == set.id) it.copy(
                weightKg = patch.weightKg, reps = patch.reps, rpe = patch.rpe, rir = patch.rir, done = patch.done,
                warmup = patch.warmup, resistanceMode = patch.resistanceMode
            ) else it })
        }
        val nextSession = snapshot.session.copy(exercises = updated, completedSets = updated.sumOf { row -> row.sets.count { it.done && !it.warmup } },
            warmupSets = updated.sumOf { row -> row.sets.count { it.done && it.warmup } })
        val id = UUID.randomUUID().toString()
        val request = JsonObject().apply {
            addProperty("revision", snapshot.session.revision)
            addProperty("mutationId", id)
            add("weightKg", gson.toJsonTree(patch.weightKg))
            add("reps", gson.toJsonTree(patch.reps))
            add("rpe", gson.toJsonTree(patch.rpe))
            add("rir", gson.toJsonTree(patch.rir))
            addProperty("done", patch.done)
            addProperty("warmup", patch.warmup)
            addProperty("resistanceMode", patch.resistanceMode)
        }
        val shouldRest = patch.done && RestPolicy.shouldRestAfter(nextSession, exercise.id, set.id)
        val restSeconds = exercise.restSeconds ?: snapshot.defaultRestSeconds
        val restGeneration = if (shouldRest && restSeconds > 0) UUID.randomUUID().toString() else null
        val restDeadline = if (restGeneration != null) System.currentTimeMillis() + restSeconds * 1_000L else null
        val nextExercise = nextSession.exercises.firstOrNull { row -> row.sets.any { !it.done } }?.id ?: exercise.id
        val nextSnapshot = snapshot.copy(session = nextSession, activeExerciseId = nextExercise,
            restEndsAtEpochMs = restDeadline, restGeneration = restGeneration, pausedRestRemainingMs = null,
            alertedRestGeneration = null)
        store.enqueue(nextSnapshot, PendingOperation(0, id, "set", snapshot.session.id, set.id, snapshot.session.revision,
            request.toString(), gson.toJson(snapshot.session), Instant.now().toString(), false))
        if (restDeadline != null && restGeneration != null)
            WorkoutOngoingService.startRest(application, snapshot.session.name)
        else WorkoutOngoingService.update(application, snapshot.session.name)
        scheduleSync()
    }

    private fun requireSnapshot(): WorkoutSnapshot = store.readSnapshot() ?: error("Open an active WorkoutApp session on your watch first.")

    private fun scheduleSync(force: Boolean = false) {
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val request = OneTimeWorkRequestBuilder<WorkoutSyncWorker>().setConstraints(constraints).build()
        WorkManager.getInstance(application).enqueueUniqueWork(
            SYNC_WORK,
            if (force) ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.KEEP,
            request
        )
    }

    companion object {
        const val SYNC_WORK = "workout-wear-sync"
        const val LB_PER_KG = 2.2046226218
    }
}

private fun Long?.orZero(): Long = this ?: 0L
