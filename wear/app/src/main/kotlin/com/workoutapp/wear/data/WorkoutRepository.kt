package com.workoutapp.wear.data

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.google.gson.JsonObject
import com.workoutapp.wear.service.WorkoutOngoingService
import com.workoutapp.wear.worker.WorkoutSyncWorker
import java.time.Instant
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * The watch's single entry point to the live workout. Logging is local-first: every edit is written
 * to the store with its projected result before any request, then replayed in order. The watch only
 * joins a workout already running in WorkoutApp; starting, editing exercises and discarding stay on
 * the phone.
 */
class WorkoutRepository private constructor(context: Context) {
    private val application = context.applicationContext
    val store = WorkoutStore.get(application)
    val secureStore = SecureTokenStore(application)
    private val api = WorkoutApi(com.workoutapp.wear.BuildConfig.API_BASE_URL, secureStore)
    private val sync = WorkoutSyncCoordinator(application, store, api)
    private val gson: Gson = GsonBuilder().serializeNulls().create()

    // Replay, refresh and conflict resolution read the queue head, wait on the network and write
    // back; one gate for the process stops the activity and the sync worker interleaving them.
    private val gate = Mutex()

    val state: StateFlow<StoreState> get() = store.state
    val notice: StateFlow<String?> get() = store.notice

    fun cached(): WorkoutSnapshot? = store.readSnapshot()

    fun isPaired(): Boolean = secureStore.isDevicePaired() && secureStore.pendingPairing() == null

    suspend fun refresh(): WorkoutSnapshot? = gate.withLock {
        if (!isPaired()) return@withLock store.readSnapshot()
        if (store.pendingOperations().isNotEmpty()) {
            syncLocked()
            val local = store.readSnapshot()
            if (local?.conflictOperationId != null || local?.pendingFinish == true && store.pendingOperations().isNotEmpty()) return@withLock local
        }
        val active = try {
            api.active()
        } catch (failure: ApiFailure) {
            if (failure.statusCode == 401) secureStore.clearDeviceSession()
            throw failure
        }
        adopt(active)
    }

    /** Takes the server's live workout while keeping queued edits and watch-only state (rest, current exercise). */
    private fun adopt(active: ActiveWorkoutResponse): WorkoutSnapshot? {
        val remote = active.session
        val next = store.update { local, pending ->
            val ownEdits = local != null && (pending.any { it.sessionId == local.session.id } || local.pendingFinish || local.conflictOperationId != null)
            when {
                // Edits that could not be sent stay visible until a later sync settles them.
                ownEdits && remote?.id != local?.session?.id -> local
                remote == null -> null
                local?.session?.id == remote.id -> local.copy(
                    session = SessionProjection.project(remote, pending),
                    unit = active.unit,
                    defaultRestSeconds = active.restSeconds,
                    activeExerciseId = local.activeExerciseId?.takeIf { id -> remote.exercises.any { it.id == id } }
                        ?: firstIncomplete(remote)
                )
                else -> WorkoutSnapshot(remote, active.unit, active.restSeconds, activeExerciseId = firstIncomplete(remote))
            }
        }
        if (next == null) WorkoutOngoingService.stop(application)
        else if (next.session.active || next.pendingFinish) WorkoutOngoingService.start(application, next.session.name)
        return next
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
            scheduleSync()
        }
        if (status.status == "expired") {
            secureStore.clearDeviceSession()
            secureStore.clearPendingPairing()
        }
        return status
    }

    fun logSet(exerciseId: String, setId: String, reps: Int, displayWeight: Double?, rir: String?) {
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

    /** Takes back the last set logged on this watch: it returns to the set page with its values kept. */
    fun undoLastSet() {
        val snapshot = requireSnapshot()
        check(snapshot.session.active && snapshot.session.pausedAt == null && !snapshot.pendingFinish) { "Resume the workout before changing a set." }
        val setId = snapshot.lastLoggedSetId ?: error("There is no set from this watch to undo.")
        val exercise = snapshot.session.exercises.firstOrNull { row -> row.sets.any { it.id == setId } }
            ?: error("That set is no longer in the workout.")
        val set = exercise.sets.first { it.id == setId }
        check(set.done) { "That set is no longer logged." }
        queueSetPatch(snapshot, exercise, set, SetPatch(set.weightKg, set.reps, set.rpe, set.rir, false, set.warmup, set.resistanceMode))
    }

    fun pause() = changePauseState(true)
    fun resume() = changePauseState(false)

    fun finish() {
        val snapshot = requireSnapshot()
        check(snapshot.session.active && !snapshot.pendingFinish) { "This workout is already finished on the watch." }
        // WorkoutApp only saves a workout with at least one completed set; queueing one without
        // would sit unsendable on the watch.
        check(hasLoggedSet(snapshot.session)) { "Log at least one set before finishing." }
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
            pendingFinish = true,
            lastLoggedSetId = null
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

    fun extendRest(seconds: Int = 30): WorkoutSnapshot? {
        val next = store.update { snapshot, _ ->
            if (snapshot == null || !snapshot.session.active || snapshot.session.pausedAt != null || snapshot.pendingFinish || seconds <= 0) snapshot
            else {
                val now = System.currentTimeMillis()
                snapshot.copy(
                    restEndsAtEpochMs = (snapshot.restEndsAtEpochMs?.coerceAtLeast(now) ?: now) + seconds * 1_000L,
                    restGeneration = UUID.randomUUID().toString(),
                    alertedRestGeneration = null,
                    pausedRestRemainingMs = null
                )
            }
        }
        next?.let { WorkoutOngoingService.startRest(application, it.session.name) }
        return next
    }

    fun skipRest(): WorkoutSnapshot? {
        val next = store.update { snapshot, _ ->
            snapshot?.copy(restEndsAtEpochMs = null, restGeneration = null, pausedRestRemainingMs = null, alertedRestGeneration = null)
        }
        next?.let { WorkoutOngoingService.update(application, it.session.name) }
        return next
    }

    fun selectExercise(exerciseId: String) {
        store.update { snapshot, _ -> snapshot?.copy(activeExerciseId = exerciseId) }
    }

    fun clearNotice() = store.clearNotice()

    suspend fun syncPending(): SyncOutcome = gate.withLock { syncLocked() }

    private suspend fun syncLocked(): SyncOutcome {
        if (store.pendingOperations().isNotEmpty() && !isPaired()) {
            return SyncOutcome(pending = true, needsPairing = true, message = "Pair this watch again to sync saved changes.")
        }
        val outcome = sync.syncPending()
        if (outcome.sessionExpired) secureStore.clearDeviceSession()
        return outcome
    }

    suspend fun resolveConflict(keepWatchValue: Boolean) {
        gate.withLock {
            sync.resolveConflict(keepWatchValue)
            syncLocked()
        }
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

    private fun changePauseState(pause: Boolean) {
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
            pausedSeconds = snapshot.session.pausedSeconds + (snapshot.session.pausedAt?.let {
                ((occurredAt.toEpochMilli() - Instant.parse(it).toEpochMilli()).coerceAtLeast(0) / 1_000L)
            } ?: 0L)
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
                weightKg = patch.weightKg, reps = patch.reps, rpe = patch.rpe, rir = patch.rir, done = patch.done
            ) else it })
        }
        val nextSession = SessionProjection.withCounts(snapshot.session.copy(exercises = updated))
        val id = UUID.randomUUID().toString()
        // Only the values a lifter logs are sent; the warm-up flag and resistance mode belong to the phone.
        val request = JsonObject().apply {
            addProperty("revision", snapshot.session.revision)
            addProperty("mutationId", id)
            add("weightKg", gson.toJsonTree(patch.weightKg))
            add("reps", gson.toJsonTree(patch.reps))
            add("rpe", gson.toJsonTree(patch.rpe))
            add("rir", gson.toJsonTree(patch.rir))
            addProperty("done", patch.done)
        }
        val shouldRest = patch.done && RestPolicy.shouldRestAfter(nextSession, exercise.id, set.id)
        val restSeconds = exercise.restSeconds ?: snapshot.defaultRestSeconds
        val restGeneration = if (shouldRest && restSeconds > 0) UUID.randomUUID().toString() else null
        val restDeadline = if (restGeneration != null) System.currentTimeMillis() + restSeconds * 1_000L else null
        val nextSnapshot = snapshot.copy(
            session = nextSession,
            activeExerciseId = if (patch.done) RestPolicy.nextExerciseId(nextSession, exercise.id, set.id) else exercise.id,
            restEndsAtEpochMs = restDeadline,
            restGeneration = restGeneration,
            pausedRestRemainingMs = null,
            alertedRestGeneration = null,
            lastLoggedSetId = if (patch.done) set.id else null
        )
        store.enqueue(nextSnapshot, PendingOperation(0, id, "set", snapshot.session.id, set.id, snapshot.session.revision,
            request.toString(), gson.toJson(snapshot.session), Instant.now().toString(), false))
        if (restDeadline != null) WorkoutOngoingService.startRest(application, snapshot.session.name)
        else WorkoutOngoingService.update(application, snapshot.session.name)
        scheduleSync()
    }

    private fun requireSnapshot(): WorkoutSnapshot = store.readSnapshot() ?: error("Open an active WorkoutApp session on your watch first.")

    /**
     * Each edit replaces any waiting sync, so a retry sitting in exponential backoff after a long
     * offline stretch does not hold a fresh edit back; mutation ids make an interrupted send safe.
     */
    private fun scheduleSync() {
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val request = OneTimeWorkRequestBuilder<WorkoutSyncWorker>()
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, SYNC_BACKOFF_SECONDS, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(application).enqueueUniqueWork(SYNC_WORK, ExistingWorkPolicy.REPLACE, request)
    }

    companion object {
        const val SYNC_WORK = "workout-wear-sync"
        const val LB_PER_KG = 2.2046226218
        private const val SYNC_BACKOFF_SECONDS = 15L

        @Volatile private var shared: WorkoutRepository? = null

        fun get(context: Context): WorkoutRepository = shared ?: synchronized(this) {
            shared ?: WorkoutRepository(context.applicationContext).also { shared = it }
        }

        fun hasLoggedSet(session: WorkoutSession): Boolean = session.exercises.any { exercise -> exercise.sets.any { it.done } }

        private fun firstIncomplete(session: WorkoutSession): String? =
            session.exercises.firstOrNull { exercise -> exercise.sets.any { !it.done } }?.id
    }
}
